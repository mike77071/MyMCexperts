import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import logger from '../lib/logger';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Zod schema for post-extraction validation ─────────────────────────────────
const perDiemRateSchema = z.object({
  levelOfCare: z.string(),
  ratePerDay: z.number().nullable(),
  notes: z.string().nullable(),
});

const procedureCodeSchema = z.object({
  code: z.string(),
  description: z.string(),
  rate: z.number().nullable(),
  unit: z.string().nullable(),
});

const ancillaryServiceSchema = z.object({
  service: z.string(),
  reimbursementBasis: z.string().nullable(),
  notes: z.string().nullable(),
});

export const matrixSchema = z.object({
  payerInfo: z.object({
    payerName: z.string().nullable(),
    payerType: z.string().nullable(),
    contractEffectiveDate: z.string().nullable(),
    contractExpirationDate: z.string().nullable(),
    contactName: z.string().nullable(),
    contactPhone: z.string().nullable(),
    contactEmail: z.string().nullable(),
    providerRelationsPhone: z.string().nullable(),
  }),
  reimbursementRates: z.object({
    perDiemRates: z.array(perDiemRateSchema),
    pdpmOrRugNotes: z.string().nullable(),
    procedureCodes: z.array(procedureCodeSchema),
    ancillaryServices: z.array(ancillaryServiceSchema),
    otherRates: z.string().nullable(),
  }),
  coveredServices: z.object({
    included: z.array(z.string()),
    excluded: z.array(z.string()),
    notes: z.string().nullable(),
  }),
  authorizationRequirements: z.object({
    requiresPriorAuth: z.array(z.string()),
    initialAuthDays: z.string().nullable(),
    concurrentReviewFrequency: z.string().nullable(),
    authContactPhone: z.string().nullable(),
    notes: z.string().nullable(),
  }),
  timelyFiling: z.object({
    initialClaimDays: z.number().nullable(),
    correctedClaimDays: z.number().nullable(),
    appealDays: z.number().nullable(),
    notes: z.string().nullable(),
  }),
  extractionMetadata: z.object({
    confidence: z.enum(['high', 'medium', 'low']),
    missingFields: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
});

export type MatrixData = z.infer<typeof matrixSchema>;

// ── Prompts ───────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a data extraction tool for skilled nursing facility (SNF) payer contracts.
Your ONLY job is to extract information that is EXPLICITLY AND LITERALLY stated in the contract text provided.

STRICT RULES — violations undermine patient billing accuracy:
1. If a value is not clearly stated in the contract text, return null for that field. Do NOT infer, estimate, assume, or fill in typical industry values.
2. Do NOT use your training knowledge to guess what a rate "typically" is. Only use what the document says.
3. Do NOT extrapolate. If the contract says "RU: $650/day" but does not mention RV, return null for RV.
4. Do NOT interpret ambiguous language as a value. If unsure, return null and add a warning.
5. Numeric fields (rates, days) must be null if not explicitly a number in the text.
6. Every null field MUST be listed in extractionMetadata.missingFields.

Domain knowledge (use ONLY to correctly identify terms, never to fill gaps):
- PDPM = Patient Driven Payment Model (Medicare fee-for-service)
- RUG levels: RU (Ultra High), RV (Very High), RH (High), RI (Medium), RB (Low), PE/PD/PC/PB/PA (Extensive Services)
- Carve-outs = services excluded from per diem, billed separately
- Prior auth = required pre-approval before admission or continued stay
- Timely filing = days after date of service to submit initial claim

Return ONLY valid JSON — no explanation, no markdown, no code fences.`;

function buildUserPrompt(pdfText: string): string {
  // Truncate to stay within token limits — contracts rarely exceed this in useful content
  const truncated = pdfText.substring(0, 80000);

  return `Extract data from this SNF payer contract. Follow all STRICT RULES.
Use null for any field not explicitly stated in the text. Do not guess.

CONTRACT TEXT:
<<<BEGIN_CONTRACT>>>
${truncated}
<<<END_CONTRACT>>>

Return this exact JSON (use null for missing fields — never omit fields, never guess):
{
  "payerInfo": {
    "payerName": null,
    "payerType": null,
    "contractEffectiveDate": null,
    "contractExpirationDate": null,
    "contactName": null,
    "contactPhone": null,
    "contactEmail": null,
    "providerRelationsPhone": null
  },
  "reimbursementRates": {
    "perDiemRates": [],
    "pdpmOrRugNotes": null,
    "procedureCodes": [],
    "ancillaryServices": [],
    "otherRates": null
  },
  "coveredServices": { "included": [], "excluded": [], "notes": null },
  "authorizationRequirements": {
    "requiresPriorAuth": [],
    "initialAuthDays": null,
    "concurrentReviewFrequency": null,
    "authContactPhone": null,
    "notes": null
  },
  "timelyFiling": {
    "initialClaimDays": null,
    "correctedClaimDays": null,
    "appealDays": null,
    "notes": null
  },
  "extractionMetadata": {
    "confidence": "high",
    "missingFields": [],
    "warnings": []
  }
}`;
}

// ── Main extraction function ───────────────────────────────────────────────────
export async function extractContractMatrix(
  redactedText: string,
  contractId: string
): Promise<MatrixData> {
  logger.info({ event: 'claude_extraction_start', contractId });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(redactedText) }],
  });

  const rawContent = response.content[0];
  if (rawContent.type !== 'text') {
    throw new Error('Unexpected Claude response type');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent.text);
  } catch {
    logger.error({ event: 'claude_json_parse_failed', contractId });
    throw new Error('Claude returned invalid JSON');
  }

  const validated = matrixSchema.safeParse(parsed);
  if (!validated.success) {
    logger.error({
      event: 'claude_schema_validation_failed',
      contractId,
      errors: validated.error.flatten(),
    });
    throw new Error('Claude response did not match expected schema');
  }

  logger.info({
    event: 'claude_extraction_complete',
    contractId,
    confidence: validated.data.extractionMetadata.confidence,
    missingFieldCount: validated.data.extractionMetadata.missingFields.length,
  });

  return validated.data;
}
