import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from './authenticate';
import prisma from '../lib/prismaClient';

// Checks that the authenticated user has access to the facilityId
// in req.params.facilityId (or req.params.id for facility routes).
// Admins always pass through.
export const requireFacilityAccess = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (req.user.role === Role.ADMIN) {
    next();
    return;
  }

  const facilityId = req.params.facilityId ?? req.params.id;

  if (!facilityId) {
    res.status(400).json({ error: 'Facility ID is required' });
    return;
  }

  const access = await prisma.userFacility.findUnique({
    where: { userId_facilityId: { userId: req.user.id, facilityId } },
  });

  if (!access) {
    res.status(403).json({ error: 'You do not have access to this facility' });
    return;
  }

  next();
};
