import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  listContracts,
  uploadContract,
  getContractMatrix,
  exportContractMatrix,
  deleteContract,
  uploadContractSchema,
} from '../controllers/contractsController';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireFacilityAccess } from '../middleware/requireFacilityAccess';
import { validate } from '../middleware/validate';

const upload = multer({
  dest: process.env.UPLOAD_DIR ?? './uploads',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Only PDF files are allowed'));
      return;
    }
    cb(null, true);
  },
  storage: multer.diskStorage({
    destination: process.env.UPLOAD_DIR ?? './uploads',
    filename: (_req, _file, cb) => {
      cb(null, `${uuidv4()}.pdf`);
    },
  }),
});

const router = Router();

router.use(authenticate);

// List all contracts the user can access
router.get('/', listContracts);

// Upload a contract PDF for a facility
router.post(
  '/facilities/:facilityId',
  requireFacilityAccess,
  requireRole('ADMIN', 'CASE_MANAGER'),
  upload.single('pdf'),
  validate(uploadContractSchema),
  uploadContract
);

// Get contract + matrix (with polling support)
router.get('/:id/matrix', getContractMatrix);

// Export matrix as Excel
router.get('/:id/export', exportContractMatrix);

// Delete contract (admin only)
router.delete('/:id', requireRole('ADMIN'), deleteContract);

export default router;
