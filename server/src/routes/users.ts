import { Router } from 'express';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  assignFacilities,
  createUserSchema,
  updateUserSchema,
  assignFacilitiesSchema,
} from '../controllers/usersController';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';

const router = Router();

// All user management is admin-only
router.use(authenticate, requireRole('ADMIN'));

router.get('/', listUsers);
router.post('/', validate(createUserSchema), createUser);
router.put('/:id', validate(updateUserSchema), updateUser);
router.delete('/:id', deleteUser);
router.patch('/:id/facilities', validate(assignFacilitiesSchema), assignFacilities);

export default router;
