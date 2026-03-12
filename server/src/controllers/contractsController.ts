import { Response } from 'express';
import { z } from 'zod';
import fs from 'fs';
import { AuthenticatedRequest } from '../middleware/authenticate';
import { EncryptedPdfError, processContract } from '../services/pdfService';
import { buildContractExcel } from '../services/excelService';
import { MatrixData } from '../services/claudeService';
import {
  enqueueContract,
  getQueuePosition,
  getQueueStats,
  getUserInFlightCount,
  MAX_BATCH_FILES,
  MAX_BATCH_BYTES,
  MAX_SINGLE_FILE_BYTES,
  MAX_USER_IN_FLIGHT,
} from '../services/processingQueue';
import prisma from '../lib/prismaClient';
import logger from '../lib/logger';

// ── List contracts ───────────────────────────────────────────────────────────
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

// ── Single upload (existing) ─────────────────────────────────────────────────
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
    const pdfParse = (await import('pdf-parse')).default;
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
      originalFilename: file.originalname,
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

  // Enqueue for processing (concurrency-controlled)
  const position = enqueueContract(contract.id);

  res.status(202).json({ contractId: contract.id, status: 'PENDING', queuePosition: position });
};

// ── Batch upload ─────────────────────────────────────────────────────────────
export const batchUploadSchema = z.object({
  // Each file needs its own payer info, sent as JSON arrays
  payerNames: z.preprocess(
    (v) => (typeof v === 'string' ? JSON.parse(v) : v),
    z.array(z.string().min(1).max(200))
  ),
  payerTypes: z.preprocess(
    (v) => (typeof v === 'string' ? JSON.parse(v) : v),
    z.array(z.string().min(1).max(100))
  ),
  effectiveDates: z.preprocess(
    (v) => (typeof v === 'string' ? JSON.parse(v) : v),
    z.array(z.string().nullable()).optional()
  ),
  expirationDates: z.preprocess(
    (v) => (typeof v === 'string' ? JSON.parse(v) : v),
    z.array(z.string().nullable()).optional()
  ),
});

export const batchUpload = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const files = req.files as Express.Multer.File[] | undefined;

  if (!files || files.length === 0) {
    res.status(400).json({ error: 'At least one PDF file is required' });
    return;
  }

  // ── Validate batch limits ──────────────────────────────────────────────────
  if (files.length > MAX_BATCH_FILES) {
    // Clean up uploaded files
    files.forEach((f) => { try { fs.unlinkSync(f.path); } catch {} });
    res.status(400).json({
      error: 'BATCH_LIMIT_EXCEEDED',
      message: `Maximum ${MAX_BATCH_FILES} files per batch.`,
      limit: MAX_BATCH_FILES,
    });
    return;
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_BATCH_BYTES) {
    files.forEach((f) => { try { fs.unlinkSync(f.path); } catch {} });
    res.status(400).json({
      error: 'BATCH_SIZE_EXCEEDED',
      message: `Total batch size exceeds ${MAX_BATCH_BYTES / 1024 / 1024}MB.`,
      totalMB: (totalBytes / 1024 / 1024).toFixed(1),
      limitMB: MAX_BATCH_BYTES / 1024 / 1024,
    });
    return;
  }

  // Check individual file sizes
  const oversizedFiles = files.filter((f) => f.size > MAX_SINGLE_FILE_BYTES);
  if (oversizedFiles.length > 0) {
    files.forEach((f) => { try { fs.unlinkSync(f.path); } catch {} });
    res.status(400).json({
      error: 'FILE_TOO_LARGE',
      message: `Individual files must be under ${MAX_SINGLE_FILE_BYTES / 1024 / 1024}MB.`,
      oversizedFiles: oversizedFiles.map((f) => ({ name: f.originalname, sizeMB: (f.size / 1024 / 1024).toFixed(1) })),
    });
    return;
  }

  // ── Per-user throttle ──────────────────────────────────────────────────────
  const inFlight = await getUserInFlightCount(req.user!.id);
  const remaining = MAX_USER_IN_FLIGHT - inFlight;
  if (remaining <= 0) {
    files.forEach((f) => { try { fs.unlinkSync(f.path); } catch {} });
    res.status(429).json({
      error: 'USER_QUEUE_FULL',
      message: `You already have ${inFlight} contracts processing. Maximum is ${MAX_USER_IN_FLIGHT}.`,
      inFlight,
      limit: MAX_USER_IN_FLIGHT,
    });
    return;
  }
  if (files.length > remaining) {
    files.forEach((f) => { try { fs.unlinkSync(f.path); } catch {} });
    res.status(429).json({
      error: 'USER_QUEUE_PARTIAL',
      message: `You can upload ${remaining} more contracts right now. ${inFlight} of ${MAX_USER_IN_FLIGHT} are still processing.`,
      remaining,
      inFlight,
      limit: MAX_USER_IN_FLIGHT,
    });
    return;
  }

  // ── Parse metadata arrays ──────────────────────────────────────────────────
  let parsed: z.infer<typeof batchUploadSchema>;
  try {
    parsed = batchUploadSchema.parse(req.body);
  } catch (err) {
    files.forEach((f) => { try { fs.unlinkSync(f.path); } catch {} });
    res.status(400).json({ error: 'Invalid metadata. Provide payerNames and payerTypes arrays matching file count.' });
    return;
  }

  const { payerNames, payerTypes, effectiveDates, expirationDates } = parsed;

  if (payerNames.length !== files.length || payerTypes.length !== files.length) {
    files.forEach((f) => { try { fs.unlinkSync(f.path); } catch {} });
    res.status(400).json({
      error: 'METADATA_MISMATCH',
      message: `Received ${files.length} files but ${payerNames.length} payer names and ${payerTypes.length} payer types. Counts must match.`,
    });
    return;
  }

  const { facilityId } = req.params;

  // ── Create contracts and enqueue ───────────────────────────────────────────
  const results: Array<{
    contractId: string;
    filename: string;
    payerName: string;
    status: string;
    queuePosition: number;
    error?: string;
  }> = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const payerName = payerNames[i];
    const payerType = payerTypes[i];
    const effectiveDate = effectiveDates?.[i] ?? null;
    const expirationDate = expirationDates?.[i] ?? null;

    // Quick encrypted PDF check
    let encrypted = false;
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const buf = fs.readFileSync(file.path);
      await pdfParse(buf, { max: 1 });
    } catch {
      encrypted = true;
    }

    if (encrypted) {
      fs.unlinkSync(file.path);
      results.push({
        contractId: '',
        filename: file.originalname,
        payerName,
        status: 'ERROR',
        queuePosition: 0,
        error: 'PDF_ENCRYPTED',
      });
      continue;
    }

    const contract = await prisma.contract.create({
      data: {
        facilityId,
        payerName,
        payerType,
        effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
        expirationDate: expirationDate ? new Date(expirationDate) : null,
        filePath: file.path,
        originalFilename: file.originalname,
        createdById: req.user!.id,
      },
    });

    const position = enqueueContract(contract.id);

    logger.info({
      event: 'contract_batch_uploaded',
      contractId: contract.id,
      facilityId,
      payerName,
      fileSize: file.size,
      filename: file.originalname,
      batchIndex: i + 1,
      batchTotal: files.length,
    });

    results.push({
      contractId: contract.id,
      filename: file.originalname,
      payerName,
      status: 'PENDING',
      queuePosition: position,
    });
  }

  res.status(202).json({
    uploaded: results.filter((r) => r.status === 'PENDING').length,
    failed: results.filter((r) => r.status === 'ERROR').length,
    total: files.length,
    contracts: results,
  });
};

// ── Reprocess a failed contract ──────────────────────────────────────────────
export const reprocessContract = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const contract = await prisma.contract.findUnique({ where: { id } });
  if (!contract) {
    res.status(404).json({ error: 'Contract not found' });
    return;
  }

  if (contract.status !== 'ERROR') {
    res.status(400).json({ error: 'Only contracts with ERROR status can be reprocessed.' });
    return;
  }

  // Check the file still exists on disk
  if (!fs.existsSync(contract.filePath)) {
    res.status(410).json({
      error: 'FILE_MISSING',
      message: 'The original PDF file is no longer available. Please re-upload.',
    });
    return;
  }

  // Reset status and increment retry count
  await prisma.contract.update({
    where: { id },
    data: {
      status: 'PENDING',
      errorMessage: null,
      retryCount: { increment: 1 },
    },
  });

  const position = enqueueContract(id);

  logger.info({
    event: 'contract_reprocess',
    contractId: id,
    retryCount: contract.retryCount + 1,
  });

  res.json({ contractId: id, status: 'PENDING', queuePosition: position });
};

// ── Batch reprocess all failed contracts for a facility ──────────────────────
export const reprocessAllFailed = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { facilityId } = req.params;

  const failedContracts = await prisma.contract.findMany({
    where: { facilityId, status: 'ERROR' },
  });

  if (failedContracts.length === 0) {
    res.json({ requeued: 0, message: 'No failed contracts to reprocess.' });
    return;
  }

  // Filter out contracts whose files are missing
  const requeued: string[] = [];
  const missing: string[] = [];

  for (const contract of failedContracts) {
    if (!fs.existsSync(contract.filePath)) {
      missing.push(contract.id);
      continue;
    }

    await prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: 'PENDING',
        errorMessage: null,
        retryCount: { increment: 1 },
      },
    });

    enqueueContract(contract.id);
    requeued.push(contract.id);
  }

  logger.info({
    event: 'batch_reprocess',
    facilityId,
    requeued: requeued.length,
    missing: missing.length,
  });

  res.json({
    requeued: requeued.length,
    missing: missing.length,
    contractIds: requeued,
  });
};

// ── Queue status ─────────────────────────────────────────────────────────────
export const getQueueStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const stats = getQueueStats();
  const userInFlight = await getUserInFlightCount(req.user!.id);

  res.json({
    queue: stats,
    user: {
      inFlight: userInFlight,
      remaining: MAX_USER_IN_FLIGHT - userInFlight,
      limit: MAX_USER_IN_FLIGHT,
    },
    limits: {
      maxBatchFiles: MAX_BATCH_FILES,
      maxBatchMB: MAX_BATCH_BYTES / 1024 / 1024,
      maxFileMB: MAX_SINGLE_FILE_BYTES / 1024 / 1024,
    },
  });
};

// ── Get contract + matrix (polling) ──────────────────────────────────────────
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
      originalFilename: contract.originalFilename,
      retryCount: contract.retryCount,
      effectiveDate: contract.effectiveDate,
      expirationDate: contract.expirationDate,
      createdAt: contract.createdAt,
      createdBy: contract.createdBy.name,
      facility: contract.facility,
      queuePosition: getQueuePosition(contract.id),
    },
    matrix: contract.matrix?.data ?? null,
  });
};

// ── Export matrix as Excel ────────────────────────────────────────────────────
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

// ── Delete contract ──────────────────────────────────────────────────────────
export const deleteContract = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;

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
