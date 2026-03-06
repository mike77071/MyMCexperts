import 'dotenv/config';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prismaClient';

const now = new Date();
const daysFromNow = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

function makeMatrix(opts: {
  payerName: string;
  payerType: string;
  effectiveDate: string;
  expirationDate: string;
  contactPhone: string;
  authPhone: string;
  rugRates: Array<{ level: string; rate: number }>;
  timelyFiling: number;
  correctedClaim: number;
  appealDays: number;
  missingFields: string[];
  confidence: 'high' | 'medium' | 'low';
}) {
  return {
    payerInfo: {
      payerName: opts.payerName,
      payerType: opts.payerType,
      contractEffectiveDate: opts.effectiveDate,
      contractExpirationDate: opts.expirationDate,
      contactName: 'Provider Relations',
      contactPhone: opts.contactPhone,
      contactEmail: null,
      providerRelationsPhone: opts.contactPhone,
    },
    reimbursementRates: {
      perDiemRates: opts.rugRates.map(({ level, rate }) => ({
        levelOfCare: level,
        ratePerDay: rate,
        notes: null,
      })),
      pdpmOrRugNotes: 'Reimbursement based on RUG-IV classification. Rates subject to annual market basket adjustment.',
      procedureCodes: [],
      ancillaryServices: [
        { service: 'Physical Therapy', reimbursementBasis: 'fee schedule', notes: 'Billed separately from per diem' },
        { service: 'Occupational Therapy', reimbursementBasis: 'fee schedule', notes: null },
        { service: 'Speech-Language Pathology', reimbursementBasis: 'fee schedule', notes: null },
      ],
      otherRates: null,
    },
    coveredServices: {
      included: [
        'Skilled nursing care',
        'Physical therapy',
        'Occupational therapy',
        'Speech-language pathology',
        'Medical supplies and equipment',
        'Medications',
        'Dietary counseling',
        'Social services',
      ],
      excluded: [
        'Custodial care',
        'Private duty nursing',
        'Cosmetic or elective procedures',
        'Dental care',
        'Vision care',
      ],
      notes: 'All services subject to medical necessity determination and authorization requirements.',
    },
    authorizationRequirements: {
      requiresPriorAuth: [
        'All skilled nursing facility admissions',
        'Therapy services exceeding 60 minutes/day',
        'Extended stays beyond initial authorized days',
      ],
      initialAuthDays: '14 days',
      concurrentReviewFrequency: 'Every 7 days',
      authContactPhone: opts.authPhone,
      notes: 'Authorization must be obtained within 24 hours of admission. Weekend admissions must be authorized by next business day.',
    },
    timelyFiling: {
      initialClaimDays: opts.timelyFiling,
      correctedClaimDays: opts.correctedClaim,
      appealDays: opts.appealDays,
      notes: 'Claims must be submitted electronically via EDI 837I. Paper claims not accepted.',
    },
    extractionMetadata: {
      confidence: opts.confidence,
      missingFields: opts.missingFields,
      warnings: [],
    },
  };
}

async function main() {
  console.log('🌱 Seeding sample data...\n');

  // ── Users ─────────────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('Admin1234!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@snf.com' },
    update: {},
    create: { email: 'admin@snf.com', passwordHash: adminHash, name: 'System Admin', role: 'ADMIN' },
  });
  console.log('✓ Admin:', admin.email);

  const pw = await bcrypt.hash('Password1!', 12);

  const sarah = await prisma.user.upsert({
    where: { email: 'sarah.johnson@mymc.com' },
    update: {},
    create: { email: 'sarah.johnson@mymc.com', passwordHash: pw, name: 'Sarah Johnson', role: 'CASE_MANAGER' },
  });
  const mike = await prisma.user.upsert({
    where: { email: 'mike.chen@mymc.com' },
    update: {},
    create: { email: 'mike.chen@mymc.com', passwordHash: pw, name: 'Mike Chen', role: 'BILLER' },
  });
  const amy = await prisma.user.upsert({
    where: { email: 'amy.viewer@mymc.com' },
    update: {},
    create: { email: 'amy.viewer@mymc.com', passwordHash: pw, name: 'Amy Viewer', role: 'VIEWER' },
  });
  console.log('✓ Users: Sarah Johnson (Case Manager), Mike Chen (Biller), Amy Viewer (Viewer)');
  console.log('  Password for all sample users: Password1!\n');

  // ── Facilities ─────────────────────────────────────────────────────────────
  const facilityData = [
    { name: 'Sunrise Skilled Nursing & Rehabilitation', address: '4521 Oak Ridge Blvd', city: 'Springfield', state: 'IL', zip: '62704', npi: '1234567890', phone: '(217) 555-0110' },
    { name: 'Meadowbrook Care Center', address: '8801 Research Blvd', city: 'Austin', state: 'TX', zip: '78758', npi: '2345678901', phone: '(512) 555-0142' },
    { name: 'Lakewood Post-Acute Rehabilitation', address: '3200 Cherry Creek Dr S', city: 'Denver', state: 'CO', zip: '80209', npi: '3456789012', phone: '(720) 555-0183' },
    { name: 'Heritage Gardens Skilled Nursing', address: '12700 Bruce B Downs Blvd', city: 'Tampa', state: 'FL', zip: '33612', npi: '4567890123', phone: '(813) 555-0167' },
  ];

  const facilities: Record<string, { id: string; name: string }> = {};
  for (const fd of facilityData) {
    let facility = await prisma.facility.findFirst({ where: { name: fd.name } });
    if (!facility) {
      facility = await prisma.facility.create({ data: fd });
    }
    facilities[fd.name] = facility;
    console.log(`✓ Facility: ${fd.name} (${fd.city}, ${fd.state})`);
  }

  // ── User → Facility assignments ────────────────────────────────────────────
  const sunrise = facilities['Sunrise Skilled Nursing & Rehabilitation'];
  const meadowbrook = facilities['Meadowbrook Care Center'];
  const lakewood = facilities['Lakewood Post-Acute Rehabilitation'];
  const heritage = facilities['Heritage Gardens Skilled Nursing'];

  await prisma.userFacility.createMany({
    data: [
      { userId: sarah.id, facilityId: sunrise.id },
      { userId: sarah.id, facilityId: meadowbrook.id },
      { userId: mike.id, facilityId: lakewood.id },
      { userId: mike.id, facilityId: heritage.id },
      { userId: amy.id, facilityId: sunrise.id },
    ],
    skipDuplicates: true,
  });
  console.log('\n✓ Facility access assigned');

  // ── Contracts ──────────────────────────────────────────────────────────────
  console.log('\n🗂  Creating contracts...\n');

  const contractSeed = [
    // SUNRISE — mix of critical, amber, error
    {
      facilityId: sunrise.id,
      payerName: 'UnitedHealthcare Community Plan',
      payerType: 'Medicaid MCO',
      effectiveDate: daysAgo(365),
      expirationDate: daysFromNow(12),   // 🔴 CRITICAL
      status: 'COMPLETE' as const,
      createdById: sarah.id,
      createdAt: daysAgo(380),
      matrix: makeMatrix({
        payerName: 'UnitedHealthcare Community Plan', payerType: 'Medicaid MCO',
        effectiveDate: daysAgo(365).toISOString().split('T')[0],
        expirationDate: daysFromNow(12).toISOString().split('T')[0],
        contactPhone: '1-800-555-0100', authPhone: '1-800-555-0101',
        rugRates: [{ level: 'RU', rate: 485 }, { level: 'RV', rate: 462 }, { level: 'RH', rate: 438 }, { level: 'RI', rate: 412 }, { level: 'RB', rate: 384 }],
        timelyFiling: 180, correctedClaim: 90, appealDays: 60,
        missingFields: ['payerInfo.contactEmail'], confidence: 'high',
      }),
    },
    {
      facilityId: sunrise.id,
      payerName: 'Aetna Medicare Advantage',
      payerType: 'Medicare Advantage',
      effectiveDate: daysAgo(400),
      expirationDate: daysFromNow(45),   // 🟡 AMBER
      status: 'COMPLETE' as const,
      createdById: sarah.id,
      createdAt: daysAgo(410),
      matrix: makeMatrix({
        payerName: 'Aetna Medicare Advantage', payerType: 'Medicare Advantage',
        effectiveDate: daysAgo(400).toISOString().split('T')[0],
        expirationDate: daysFromNow(45).toISOString().split('T')[0],
        contactPhone: '1-800-555-0200', authPhone: '1-800-555-0201',
        rugRates: [{ level: 'RU', rate: 650 }, { level: 'RV', rate: 618 }, { level: 'RH', rate: 587 }, { level: 'RI', rate: 558 }, { level: 'RB', rate: 524 }],
        timelyFiling: 365, correctedClaim: 180, appealDays: 90,
        missingFields: [], confidence: 'high',
      }),
    },
    {
      facilityId: sunrise.id,
      payerName: 'Blue Cross Blue Shield PPO',
      payerType: 'Commercial',
      effectiveDate: daysAgo(200),
      expirationDate: daysFromNow(165),  // ✅ Safe
      status: 'COMPLETE' as const,
      createdById: admin.id,
      createdAt: daysAgo(210),
      matrix: makeMatrix({
        payerName: 'Blue Cross Blue Shield PPO', payerType: 'Commercial',
        effectiveDate: daysAgo(200).toISOString().split('T')[0],
        expirationDate: daysFromNow(165).toISOString().split('T')[0],
        contactPhone: '1-800-555-0300', authPhone: '1-800-555-0301',
        rugRates: [{ level: 'RU', rate: 720 }, { level: 'RV', rate: 680 }, { level: 'RH', rate: 645 }, { level: 'RI', rate: 610 }, { level: 'RB', rate: 570 }],
        timelyFiling: 365, correctedClaim: 180, appealDays: 90,
        missingFields: ['payerInfo.contactEmail', 'payerInfo.contactName'], confidence: 'medium',
      }),
    },
    {
      facilityId: sunrise.id,
      payerName: 'Humana Gold Plus HMO',
      payerType: 'Medicare Advantage',
      effectiveDate: daysAgo(90),
      expirationDate: daysFromNow(275),
      status: 'ERROR' as const,
      errorMessage: 'PDF appears to be a scanned document with low text quality. OCR extraction failed — please re-upload a cleaner copy.',
      createdById: sarah.id,
      createdAt: daysAgo(5),
    },

    // MEADOWBROOK — 2 expiring, 1 processing
    {
      facilityId: meadowbrook.id,
      payerName: 'Molina Healthcare of Texas',
      payerType: 'Medicaid MCO',
      effectiveDate: daysAgo(335),
      expirationDate: daysFromNow(28),   // 🔴 CRITICAL
      status: 'COMPLETE' as const,
      createdById: sarah.id,
      createdAt: daysAgo(340),
      matrix: makeMatrix({
        payerName: 'Molina Healthcare of Texas', payerType: 'Medicaid MCO',
        effectiveDate: daysAgo(335).toISOString().split('T')[0],
        expirationDate: daysFromNow(28).toISOString().split('T')[0],
        contactPhone: '1-800-555-0400', authPhone: '1-800-555-0401',
        rugRates: [{ level: 'RU', rate: 465 }, { level: 'RV', rate: 443 }, { level: 'RH', rate: 420 }, { level: 'RI', rate: 396 }, { level: 'RB', rate: 370 }],
        timelyFiling: 180, correctedClaim: 90, appealDays: 60,
        missingFields: ['payerInfo.contactEmail'], confidence: 'high',
      }),
    },
    {
      facilityId: meadowbrook.id,
      payerName: 'Cigna HealthSpring',
      payerType: 'Medicare Advantage',
      effectiveDate: daysAgo(290),
      expirationDate: daysFromNow(75),   // 🟡 YELLOW
      status: 'COMPLETE' as const,
      createdById: admin.id,
      createdAt: daysAgo(295),
      matrix: makeMatrix({
        payerName: 'Cigna HealthSpring', payerType: 'Medicare Advantage',
        effectiveDate: daysAgo(290).toISOString().split('T')[0],
        expirationDate: daysFromNow(75).toISOString().split('T')[0],
        contactPhone: '1-800-555-0500', authPhone: '1-800-555-0501',
        rugRates: [{ level: 'RU', rate: 635 }, { level: 'RV', rate: 603 }, { level: 'RH', rate: 572 }, { level: 'RI', rate: 541 }, { level: 'RB', rate: 508 }],
        timelyFiling: 365, correctedClaim: 180, appealDays: 90,
        missingFields: [], confidence: 'high',
      }),
    },
    {
      facilityId: meadowbrook.id,
      payerName: 'WellCare Medicare Advantage',
      payerType: 'Medicare Advantage',
      effectiveDate: null,
      expirationDate: null,
      status: 'PROCESSING_AI' as const,
      createdById: sarah.id,
      createdAt: daysAgo(0),
    },

    // LAKEWOOD — 1 amber, 1 safe, 1 pending
    {
      facilityId: lakewood.id,
      payerName: 'Aetna Better Health of Colorado',
      payerType: 'Medicaid MCO',
      effectiveDate: daysAgo(310),
      expirationDate: daysFromNow(55),   // 🟡 AMBER
      status: 'COMPLETE' as const,
      createdById: mike.id,
      createdAt: daysAgo(315),
      matrix: makeMatrix({
        payerName: 'Aetna Better Health of Colorado', payerType: 'Medicaid MCO',
        effectiveDate: daysAgo(310).toISOString().split('T')[0],
        expirationDate: daysFromNow(55).toISOString().split('T')[0],
        contactPhone: '1-800-555-0600', authPhone: '1-800-555-0601',
        rugRates: [{ level: 'RU', rate: 498 }, { level: 'RV', rate: 473 }, { level: 'RH', rate: 448 }, { level: 'RI', rate: 422 }, { level: 'RB', rate: 395 }],
        timelyFiling: 180, correctedClaim: 90, appealDays: 60,
        missingFields: ['payerInfo.contactEmail'], confidence: 'high',
      }),
    },
    {
      facilityId: lakewood.id,
      payerName: 'UnitedHealthcare Medicare Advantage',
      payerType: 'Medicare Advantage',
      effectiveDate: daysAgo(60),
      expirationDate: daysFromNow(305),  // ✅ Safe
      status: 'COMPLETE' as const,
      createdById: mike.id,
      createdAt: daysAgo(65),
      matrix: makeMatrix({
        payerName: 'UnitedHealthcare Medicare Advantage', payerType: 'Medicare Advantage',
        effectiveDate: daysAgo(60).toISOString().split('T')[0],
        expirationDate: daysFromNow(305).toISOString().split('T')[0],
        contactPhone: '1-800-555-0700', authPhone: '1-800-555-0701',
        rugRates: [{ level: 'RU', rate: 672 }, { level: 'RV', rate: 638 }, { level: 'RH', rate: 606 }, { level: 'RI', rate: 574 }, { level: 'RB', rate: 540 }],
        timelyFiling: 365, correctedClaim: 180, appealDays: 90,
        missingFields: [], confidence: 'high',
      }),
    },
    {
      facilityId: lakewood.id,
      payerName: 'Humana Commercial PPO',
      payerType: 'Commercial',
      effectiveDate: null,
      expirationDate: null,
      status: 'PENDING' as const,
      createdById: mike.id,
      createdAt: daysAgo(0),
    },

    // HERITAGE — 1 critical, 1 yellow
    {
      facilityId: heritage.id,
      payerName: 'Simply Healthcare',
      payerType: 'Medicaid MCO',
      effectiveDate: daysAgo(345),
      expirationDate: daysFromNow(20),   // 🔴 CRITICAL
      status: 'COMPLETE' as const,
      createdById: mike.id,
      createdAt: daysAgo(350),
      matrix: makeMatrix({
        payerName: 'Simply Healthcare', payerType: 'Medicaid MCO',
        effectiveDate: daysAgo(345).toISOString().split('T')[0],
        expirationDate: daysFromNow(20).toISOString().split('T')[0],
        contactPhone: '1-800-555-0800', authPhone: '1-800-555-0801',
        rugRates: [{ level: 'RU', rate: 478 }, { level: 'RV', rate: 454 }, { level: 'RH', rate: 430 }, { level: 'RI', rate: 405 }, { level: 'RB', rate: 378 }],
        timelyFiling: 180, correctedClaim: 90, appealDays: 60,
        missingFields: ['payerInfo.contactEmail'], confidence: 'high',
      }),
    },
    {
      facilityId: heritage.id,
      payerName: 'Devoted Health',
      payerType: 'Medicare Advantage',
      effectiveDate: daysAgo(275),
      expirationDate: daysFromNow(88),   // 🟡 YELLOW
      status: 'COMPLETE' as const,
      createdById: admin.id,
      createdAt: daysAgo(280),
      matrix: makeMatrix({
        payerName: 'Devoted Health', payerType: 'Medicare Advantage',
        effectiveDate: daysAgo(275).toISOString().split('T')[0],
        expirationDate: daysFromNow(88).toISOString().split('T')[0],
        contactPhone: '1-800-555-0900', authPhone: '1-800-555-0901',
        rugRates: [{ level: 'RU', rate: 642 }, { level: 'RV', rate: 610 }, { level: 'RH', rate: 579 }, { level: 'RI', rate: 548 }, { level: 'RB', rate: 515 }],
        timelyFiling: 365, correctedClaim: 180, appealDays: 90,
        missingFields: [], confidence: 'high',
      }),
    },
  ];

  for (const c of contractSeed) {
    const existing = await prisma.contract.findFirst({
      where: { facilityId: c.facilityId, payerName: c.payerName },
    });
    if (existing) {
      console.log(`  ↩ Skipping (exists): ${c.payerName}`);
      continue;
    }

    const { matrix, ...contractFields } = c as typeof c & { matrix?: object };

    const contract = await prisma.contract.create({
      data: {
        ...contractFields,
        filePath: `uploads/seed-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
        createdAt: contractFields.createdAt,
      },
    });

    if (matrix && c.status === 'COMPLETE') {
      await prisma.contractMatrix.create({
        data: {
          contractId: contract.id,
          data: matrix,
          extractedAt: contractFields.createdAt ?? now,
        },
      });
    }

    const icon = c.status === 'COMPLETE' ? '✓' : c.status === 'ERROR' ? '✗' : c.status === 'PENDING' ? '⏳' : '⟳';
    console.log(`  ${icon} ${c.payerName} [${c.status}]`);
  }

  console.log('\n✅ Seed complete!\n');
  console.log('Sample accounts:');
  console.log('  admin@snf.com        / Admin1234!   (Admin — all facilities)');
  console.log('  sarah.johnson@mymc.com / Password1! (Case Manager — Sunrise, Meadowbrook)');
  console.log('  mike.chen@mymc.com   / Password1!   (Biller — Lakewood, Heritage)');
  console.log('  amy.viewer@mymc.com  / Password1!   (Viewer — Sunrise)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
