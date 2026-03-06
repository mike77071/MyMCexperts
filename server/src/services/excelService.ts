import ExcelJS from 'exceljs';
import { MatrixData } from './claudeService';

const NULL_STYLE: Partial<ExcelJS.Style> = {
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } },
  font: { italic: true, color: { argb: 'FF888888' } },
};

const HEADER_STYLE: Partial<ExcelJS.Style> = {
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } },
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
};

const SECTION_STYLE: Partial<ExcelJS.Style> = {
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } },
  font: { bold: true },
};

function cell(ws: ExcelJS.Worksheet, row: number, col: number, value: unknown, style?: Partial<ExcelJS.Style>) {
  const c = ws.getCell(row, col);
  c.value = value === null ? 'Not found in contract' : (value as ExcelJS.CellValue);
  if (value === null) Object.assign(c, { style: NULL_STYLE });
  else if (style) Object.assign(c, { style });
  return c;
}

function sectionHeader(ws: ExcelJS.Worksheet, row: number, title: string, colSpan: number) {
  const c = ws.getCell(row, 1);
  c.value = title;
  Object.assign(c, { style: SECTION_STYLE });
  ws.mergeCells(row, 1, row, colSpan);
  return row + 1;
}

export async function buildContractExcel(
  matrix: MatrixData,
  contractMeta: { payerName: string; facilityName: string; createdAt: string }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SNF Contract Matrix App';
  wb.created = new Date();

  const ws = wb.addWorksheet('Contract Matrix');
  ws.columns = [
    { width: 30 },
    { width: 50 },
    { width: 20 },
    { width: 20 },
    { width: 30 },
  ];

  let row = 1;

  // ── Title ──────────────────────────────────────────────────────────────────
  const titleCell = ws.getCell(row, 1);
  titleCell.value = 'SNF Contract Matrix';
  titleCell.style = { font: { bold: true, size: 16 } };
  ws.mergeCells(row, 1, row, 5);
  row++;

  ws.getCell(row, 1).value = `Facility: ${contractMeta.facilityName}`;
  ws.getCell(row, 3).value = `Payer: ${contractMeta.payerName}`;
  ws.getCell(row, 5).value = `Generated: ${contractMeta.createdAt}`;
  row += 2;

  // ── Payer Info ─────────────────────────────────────────────────────────────
  row = sectionHeader(ws, row, 'PAYER INFORMATION', 5);
  const pi = matrix.payerInfo;
  const payerFields: Array<[string, string | null]> = [
    ['Payer Name', pi.payerName],
    ['Payer Type', pi.payerType],
    ['Effective Date', pi.contractEffectiveDate],
    ['Expiration Date', pi.contractExpirationDate],
    ['Contact Name', pi.contactName],
    ['Contact Phone', pi.contactPhone],
    ['Contact Email', pi.contactEmail],
    ['Provider Relations Phone', pi.providerRelationsPhone],
  ];
  for (const [label, value] of payerFields) {
    cell(ws, row, 1, label, HEADER_STYLE);
    cell(ws, row, 2, value);
    row++;
  }
  row++;

  // ── Reimbursement Rates ────────────────────────────────────────────────────
  row = sectionHeader(ws, row, 'REIMBURSEMENT RATES', 5);

  if (matrix.reimbursementRates.perDiemRates.length > 0) {
    // Header row
    ['Level of Care', 'Rate Per Day', 'Notes'].forEach((h, i) => {
      cell(ws, row, i + 1, h, HEADER_STYLE);
    });
    row++;
    for (const rate of matrix.reimbursementRates.perDiemRates) {
      cell(ws, row, 1, rate.levelOfCare);
      cell(ws, row, 2, rate.ratePerDay !== null ? `$${rate.ratePerDay}` : null);
      cell(ws, row, 3, rate.notes);
      row++;
    }
  } else {
    cell(ws, row, 1, 'Per Diem Rates', HEADER_STYLE);
    cell(ws, row, 2, null);
    row++;
  }

  cell(ws, row, 1, 'PDPM / RUG Notes', HEADER_STYLE);
  cell(ws, row, 2, matrix.reimbursementRates.pdpmOrRugNotes);
  ws.mergeCells(row, 2, row, 5);
  row++;

  if (matrix.reimbursementRates.procedureCodes.length > 0) {
    ['Code', 'Description', 'Rate', 'Unit'].forEach((h, i) => {
      cell(ws, row, i + 1, h, HEADER_STYLE);
    });
    row++;
    for (const pc of matrix.reimbursementRates.procedureCodes) {
      cell(ws, row, 1, pc.code);
      cell(ws, row, 2, pc.description);
      cell(ws, row, 3, pc.rate !== null ? `$${pc.rate}` : null);
      cell(ws, row, 4, pc.unit);
      row++;
    }
  }

  cell(ws, row, 1, 'Other Rates', HEADER_STYLE);
  cell(ws, row, 2, matrix.reimbursementRates.otherRates);
  ws.mergeCells(row, 2, row, 5);
  row += 2;

  // ── Covered Services ───────────────────────────────────────────────────────
  row = sectionHeader(ws, row, 'COVERED SERVICES & EXCLUSIONS', 5);
  cell(ws, row, 1, 'Included Services', HEADER_STYLE);
  cell(ws, row, 2, matrix.coveredServices.included.join('\n') || null);
  ws.mergeCells(row, 2, row, 5);
  row++;
  cell(ws, row, 1, 'Excluded Services', HEADER_STYLE);
  cell(ws, row, 2, matrix.coveredServices.excluded.join('\n') || null);
  ws.mergeCells(row, 2, row, 5);
  row++;
  cell(ws, row, 1, 'Notes', HEADER_STYLE);
  cell(ws, row, 2, matrix.coveredServices.notes);
  ws.mergeCells(row, 2, row, 5);
  row += 2;

  // ── Authorization Requirements ─────────────────────────────────────────────
  row = sectionHeader(ws, row, 'AUTHORIZATION REQUIREMENTS', 5);
  const ar = matrix.authorizationRequirements;
  cell(ws, row, 1, 'Services Requiring Prior Auth', HEADER_STYLE);
  cell(ws, row, 2, ar.requiresPriorAuth.join('\n') || null);
  ws.mergeCells(row, 2, row, 5);
  row++;

  const authFields: Array<[string, string | null]> = [
    ['Initial Auth Days', ar.initialAuthDays],
    ['Concurrent Review Frequency', ar.concurrentReviewFrequency],
    ['Auth Contact Phone', ar.authContactPhone],
    ['Notes', ar.notes],
  ];
  for (const [label, value] of authFields) {
    cell(ws, row, 1, label, HEADER_STYLE);
    cell(ws, row, 2, value);
    ws.mergeCells(row, 2, row, 5);
    row++;
  }
  row++;

  // ── Timely Filing ─────────────────────────────────────────────────────────
  row = sectionHeader(ws, row, 'TIMELY FILING LIMITS', 5);
  const tf = matrix.timelyFiling;
  const filingFields: Array<[string, number | string | null]> = [
    ['Initial Claim (days from service)', tf.initialClaimDays],
    ['Corrected Claim (days)', tf.correctedClaimDays],
    ['Appeal Deadline (days)', tf.appealDays],
    ['Notes', tf.notes],
  ];
  for (const [label, value] of filingFields) {
    cell(ws, row, 1, label, HEADER_STYLE);
    cell(ws, row, 2, value);
    ws.mergeCells(row, 2, row, 5);
    row++;
  }
  row++;

  // ── Extraction Metadata ───────────────────────────────────────────────────
  row = sectionHeader(ws, row, 'EXTRACTION METADATA', 5);
  cell(ws, row, 1, 'AI Confidence', HEADER_STYLE);
  cell(ws, row, 2, matrix.extractionMetadata.confidence.toUpperCase());
  row++;
  cell(ws, row, 1, 'Fields Not Found in Contract', HEADER_STYLE);
  cell(ws, row, 2, matrix.extractionMetadata.missingFields.join(', ') || 'None');
  ws.mergeCells(row, 2, row, 5);
  row++;
  cell(ws, row, 1, 'Warnings', HEADER_STYLE);
  cell(ws, row, 2, matrix.extractionMetadata.warnings.join('\n') || 'None');
  ws.mergeCells(row, 2, row, 5);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
