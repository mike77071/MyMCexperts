import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import {
  listContracts,
  uploadContract,
  batchUpload,
  reprocessContract,
  reprocessAllFailed,
  getQueueStatus,
  getContractMatrix,
  exportContractMatrix,
  deleteContract,
  uploadContractSchema,
} from '../controllers/contractsController';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireFacilityAccess } from '../middleware/requireFacilityAccess';
import { validate } from '../middleware/validate';

const storage = multer.diskStorage({
  destination: process.env.UPLOAD_DIR ?? './uploads',
  filename: (_req, _file, cb) => {
    cb(null, `${uuidv4()}.pdf`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file (batch total checked in controller)
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Only PDF files are allowed'));
      return;
    }
    cb(null, true);
  },
});

const router = Router();

router.use(authenticate);

// List all contracts the user can access
router.get('/', listContracts);

// Queue status (must be before /:id routes)
router.get('/queue/status', getQueueStatus);

// Upload a single contract PDF for a facility
router.post(
  '/facilities/:facilityId',
  requireFacilityAccess,
  requireRole('ADMIN', 'CASE_MANAGER'),
  upload.single('pdf'),
  validate(uploadContractSchema),
  uploadContract
);

// Batch upload multiple contract PDFs for a facility
router.post(
  '/facilities/:facilityId/batch',
  requireFacilityAccess,
  requireRole('ADMIN', 'CASE_MANAGER'),
  upload.array('pdfs', 10), // max 10 files
  batchUpload
);

// Reprocess a single failed contract
router.post('/:id/reprocess', requireRole('ADMIN', 'CASE_MANAGER'), reprocessContract);

// Reprocess all failed contracts for a facility
router.post(
  '/facilities/:facilityId/reprocess-all',
  requireFacilityAccess,
  requireRole('ADMIN', 'CASE_MANAGER'),
  reprocessAllFailed
);

// Get contract + matrix (with polling support)
router.get('/:id/matrix', getContractMatrix);

// Export matrix as Excel
router.get('/:id/export', exportContractMatrix);

// Delete contract (admin only)
router.delete('/:id', requireRole('ADMIN'), deleteContract);

export default router;
