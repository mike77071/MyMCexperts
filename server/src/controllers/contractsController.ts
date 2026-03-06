import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/authenticate';
import { EncryptedPdfError, processContract } from '../services/pdfService';
import { buildContractExcel } from '../services/excelService';
import { MatrixData } from '../services/claudeService';
import prisma from '../lib/prismaClient';
import logger from '../lib/logger';

export const listContracts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const isAdmin = req.user?.role === 'ADMIN';

  const contracts = await prisma.contract.findMany({
    where: isAdmin
      ? undefined
      : { facility: { users: { some: { userId: req.user!.id } } } },
    include: {
      facility: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      matrix: { select: { extractedAt: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ contracts });
};

export const uploadContractSchema = z.object({
  payerName: z.string().min(1).max(200),
  payerType: z.string().min(1).max(100),
  effectiveDate: z.string().optional().nullable(),
  expirationDate: z.string().optional().nullable(),
});

export const uploadContract = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: 'PDF file is required' });
    return;
  }

  const { payerName, payerType, effectiveDate, expirationDate } = req.body as z.infer<
    typeof uploadContractSchema
  >;
  const { facilityId } = req.params;

  // Check if the PDF is immediately readable (catches hard-encrypted files synchronously)
  try {
    // Quick synchronous check: if pdf-parse can at least open it without throwing, we proceed.
    // Full text extraction + OCR happens asynchronously in processContract().
    // We do a lightweight check here to give instant feedback on truly locked files.
    const pdfParse = (await import('pdf-parse')).default;
    const fs = (await import('fs')).default;
    const buf = fs.readFileSync(file.path);
    try {
      await pdfParse(buf, { max: 1 }); // parse only 1 page for quick check
    } catch {
      fs.unlinkSync(file.path);
      res.status(422).json({
        error: 'PDF_ENCRYPTED',
        message: 'This PDF is encrypted or copy-protected and cannot be read.',
        instructions: [
          'Open the PDF on your computer using Adobe Acrobat or your default PDF viewer.',
          "Go to File → Print, then choose 'Save as PDF' or 'Microsoft Print to PDF' as the printer.",
          'Save the new copy to your computer.',
          'Upload that new copy here — it will be readable.',
        ],
      });
      return;
    }
  } catch (err) {
    if (err instanceof EncryptedPdfError) {
      res.status(422).json({
        error: 'PDF_ENCRYPTED',
        message: 'This PDF is encrypted or copy-protected and cannot be read.',
        instructions: [
          'Open the PDF on your computer using Adobe Acrobat or your default PDF viewer.',
          "Go to File → Print, then choose 'Save as PDF' or 'Microsoft Print to PDF' as the printer.",
          'Save the new copy to your computer.',
          'Upload that new copy here — it will be readable.',
        ],
      });
      return;
    }
    throw err;
  }

  const contract = await prisma.contract.create({
    data: {
      facilityId,
      payerName,
      payerType,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
      expirationDate: expirationDate ? new Date(expirationDate) : null,
      filePath: file.path,
      createdById: req.user!.id,
    },
  });

  logger.info({
    event: 'contract_uploaded',
    contractId: contract.id,
    facilityId,
    payerName,
    fileSize: file.size,
    filename: file.originalname,
  });

  // Fire-and-forget — client polls for status
  processContract(contract.id).catch((err) => {
    logger.error({ event: 'process_contract_uncaught', contractId: contract.id, error: String(err) });
  });

  res.status(202).json({ contractId: contract.id, status: 'PENDING' });
};

export const getContractMatrix = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      matrix: true,
      facility: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
    },
  });

  if (!contract) {
    res.status(404).json({ error: 'Contract not found' });
    return;
  }

  res.json({
    contract: {
      id: contract.id,
      payerName: contract.payerName,
      payerType: contract.payerType,
      status: contract.status,
      errorMessage: contract.errorMessage,
      effectiveDate: contract.effectiveDate,
      expirationDate: contract.expirationDate,
      createdAt: contract.createdAt,
      createdBy: contract.createdBy.name,
      facility: contract.facility,
    },
    matrix: contract.matrix?.data ?? null,
  });
};

export const exportContractMatrix = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;

  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      matrix: true,
      facility: { select: { name: true } },
    },
  });

  if (!contract || !contract.matrix) {
    res.status(404).json({ error: 'Contract matrix not found or not yet processed' });
    return;
  }

  const buffer = await buildContractExcel(contract.matrix.data as MatrixData, {
    payerName: contract.payerName,
    facilityName: contract.facility.name,
    createdAt: contract.createdAt.toLocaleDateString(),
  });

  const filename = `contract-matrix-${contract.payerName.replace(/\s+/g, '-')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
};

export const deleteContract = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const fs = (await import('fs')).default;

  const contract = await prisma.contract.findUnique({ where: { id } });
  if (!contract) {
    res.status(404).json({ error: 'Contract not found' });
    return;
  }

  // Delete PDF file from disk
  if (fs.existsSync(contract.filePath)) {
    fs.unlinkSync(contract.filePath);
  }

  await prisma.contract.delete({ where: { id } });
  res.json({ message: 'Contract deleted' });
};
