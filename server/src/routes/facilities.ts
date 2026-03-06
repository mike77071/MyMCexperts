import { Router } from 'express';
import {
  listFacilities,
  getFacility,
  createFacility,
  updateFacility,
  deleteFacility,
  facilitySchema,
} from '../controllers/facilitiesController';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireFacilityAccess } from '../middleware/requireFacilityAccess';
import { validate } from '../middleware/validate';

const router = Router();

router.use(authenticate);

router.get('/', listFacilities);
router.post('/', requireRole('ADMIN'), validate(facilitySchema), createFacility);
router.get('/:id', requireFacilityAccess, getFacility);
router.put('/:id', requireRole('ADMIN'), validate(facilitySchema), updateFacility);
router.delete('/:id', requireRole('ADMIN'), deleteFacility);

export default router;
