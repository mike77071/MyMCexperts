import { Response } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authenticate';
import prisma from '../lib/prismaClient';

export const facilitySchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(300),
  city: z.string().min(1).max(100),
  state: z.string().length(2).toUpperCase(),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code'),
  npi: z.preprocess(
    (v) => (v === '' ? null : v),
    z.string().regex(/^\d{10}$/, 'NPI must be 10 digits').nullable().optional()
  ),
  phone: z.preprocess(
    (v) => (v === '' ? null : v),
    z.string().max(20).nullable().optional()
  ),
});

export const listFacilities = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const isAdmin = req.user?.role === Role.ADMIN;

  const facilities = await prisma.facility.findMany({
    where: isAdmin
      ? undefined
      : { users: { some: { userId: req.user!.id } } },
    include: {
      _count: { select: { contracts: true } },
    },
    orderBy: { name: 'asc' },
  });

  res.json({ facilities });
};

export const getFacility = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const facility = await prisma.facility.findUnique({
    where: { id },
    include: {
      contracts: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          payerName: true,
          payerType: true,
          effectiveDate: true,
          expirationDate: true,
          status: true,
          createdAt: true,
          createdBy: { select: { name: true } },
        },
      },
    },
  });

  if (!facility) {
    res.status(404).json({ error: 'Facility not found' });
    return;
  }

  res.json({ facility });
};

export const createFacility = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const data = req.body as z.infer<typeof facilitySchema>;

  const facility = await prisma.facility.create({ data });
  res.status(201).json({ facility });
};

export const updateFacility = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const data = req.body as z.infer<typeof facilitySchema>;

  const facility = await prisma.facility.update({ where: { id }, data });
  res.json({ facility });
};

export const deleteFacility = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  await prisma.facility.delete({ where: { id } });
  res.json({ message: 'Facility deleted' });
};
