import logger from '../lib/logger';

interface FacilityContext {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  npi?: string | null;
  phone?: string | null;
}

interface RedactionResult {
  redactedText: string;
  redactionCount: number;
}

const EIN_PATTERN = /\b\d{2}-\d{7}\b/g;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(new RegExp(pattern.source, pattern.flags));
  return matches?.length ?? 0;
}

export function redactPdfText(
  text: string,
  facility: FacilityContext,
  payerName: string,
  contractId: string
): RedactionResult {
  let redacted = text;
  let redactionCount = 0;

  // Build ordered list of replacements — specific DB values first, patterns last
  const replacements: Array<[RegExp, string]> = [
    [new RegExp(escapeRegex(facility.name), 'gi'), '[FACILITY_NAME]'],
    [new RegExp(escapeRegex(facility.address), 'gi'), '[FACILITY_ADDRESS]'],
    [new RegExp(escapeRegex(facility.city), 'gi'), '[FACILITY_CITY]'],
    [new RegExp(escapeRegex(facility.zip), 'g'), '[FACILITY_ZIP]'],
    [new RegExp(escapeRegex(payerName), 'gi'), '[PAYER_NAME]'],
  ];

  // Only add state if it's long enough to be unambiguous (avoid redacting "CA" in "CARDIAC")
  if (facility.state.length > 2) {
    replacements.push([new RegExp(escapeRegex(facility.state), 'g'), '[FACILITY_STATE]']);
  }

  // NPI: redact the facility's specific NPI first, then any remaining 10-digit blocks
  if (facility.npi) {
    replacements.push([new RegExp(escapeRegex(facility.npi), 'g'), '[FACILITY_NPI]']);
  }
  // Generic NPI pattern (10 consecutive digits not already replaced)
  replacements.push([/\b\d{10}\b/g, '[NPI]']);

  // EIN / Tax ID
  replacements.push([EIN_PATTERN, '[FACILITY_EIN]']);

  // Facility phone: only redact the known facility number — unknown numbers are payer contacts
  if (facility.phone) {
    replacements.push([new RegExp(escapeRegex(facility.phone), 'g'), '[FACILITY_PHONE]']);
  }

  for (const [pattern, placeholder] of replacements) {
    const count = countMatches(redacted, pattern);
    if (count > 0) {
      redacted = redacted.replace(pattern, placeholder);
      redactionCount += count;
    }
  }

  logger.info({ event: 'redaction_complete', contractId, redactionCount });

  return { redactedText: redacted, redactionCount };
}
