import fs from 'fs';
import pdfParse from 'pdf-parse';
import { ContractStatus } from '@prisma/client';
import prisma from '../lib/prismaClient';
import logger from '../lib/logger';
import { extractTextWithOCR } from './ocrService';
import { redactPdfText } from './redactionService';
import { extractContractMatrix } from './claudeService';

export class EncryptedPdfError extends Error {
  constructor() {
    super('PDF_ENCRYPTED');
    this.name = 'EncryptedPdfError';
  }
}

async function updateStatus(contractId: string, status: ContractStatus, errorMessage?: string) {
  await prisma.contract.update({
    where: { id: contractId },
    data: { status, ...(errorMessage ? { errorMessage } : {}) },
  });
}

// Detects PDF type and returns extracted text
// Throws EncryptedPdfError if the PDF cannot be read at all
async function getContractText(filePath: string, contractId: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);

  await updateStatus(contractId, ContractStatus.PROCESSING_TEXT);

  let result;
  try {
    result = await pdfParse(buffer);
  } catch {
    // pdf-parse throws on truly encrypted (password-locked) PDFs
    fs.unlinkSync(filePath);
    throw new EncryptedPdfError();
  }

  const text = result.text?.trim() ?? '';

  if (text.length >= 200) {
    logger.info({ event: 'pdf_text_extracted', contractId, chars: text.length, method: 'digital' });
    return text;
  }

  // Too little text — likely a scanned PDF. Fall back to Tesseract OCR.
  logger.info({ event: 'pdf_ocr_fallback', contractId, chars: text.length });
  await updateStatus(contractId, ContractStatus.PROCESSING_OCR);

  const ocrText = await extractTextWithOCR(filePath);

  if (ocrText.trim().length < 100) {
    // OCR also produced nothing — PDF is unreadable
    fs.unlinkSync(filePath);
    throw new EncryptedPdfError();
  }

  logger.info({ event: 'pdf_text_extracted', contractId, chars: ocrText.length, method: 'ocr' });
  return ocrText;
}

// Main async pipeline — called fire-and-forget from the controller (returns 202 immediately)
export async function processContract(contractId: string): Promise<void> {
  let filePath: string | null = null;

  try {
    const contract = await prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: { facility: true },
    });

    filePath = contract.filePath;

    // Step 1: Extract text (digital or OCR)
    const rawText = await getContractText(filePath, contractId);

    // Step 2: Redact facility PII and payer name before sending to Claude
    const { redactedText } = redactPdfText(
      rawText,
      {
        name: contract.facility.name,
        address: contract.facility.address,
        city: contract.facility.city,
        state: contract.facility.state,
        zip: contract.facility.zip,
        npi: contract.facility.npi,
        phone: contract.facility.phone,
      },
      contract.payerName,
      contractId
    );

    // Step 3: Claude extracts the matrix from the redacted text
    await updateStatus(contractId, ContractStatus.PROCESSING_AI);
    const matrixData = await extractContractMatrix(redactedText, contractId);

    // Step 4: Merge user-entered fields back in (these were redacted before Claude saw them)
    matrixData.payerInfo.payerName = contract.payerName;
    matrixData.payerInfo.payerType = contract.payerType;
    if (contract.effectiveDate && !matrixData.payerInfo.contractEffectiveDate) {
      matrixData.payerInfo.contractEffectiveDate = contract.effectiveDate.toISOString().split('T')[0];
    }
    if (contract.expirationDate && !matrixData.payerInfo.contractExpirationDate) {
      matrixData.payerInfo.contractExpirationDate = contract.expirationDate.toISOString().split('T')[0];
    }

    // Step 5: Save to database
    await prisma.contractMatrix.upsert({
      where: { contractId },
      create: { contractId, data: matrixData as object },
      update: { data: matrixData as object, extractedAt: new Date() },
    });

    await updateStatus(contractId, ContractStatus.COMPLETE);
    logger.info({ event: 'contract_processed', contractId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ event: 'contract_processing_failed', contractId, error: message });

    if (contractId) {
      await updateStatus(contractId, ContractStatus.ERROR, message).catch(() => {});
    }
  }
}
