import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authenticate';
import prisma from '../lib/prismaClient';
import logger from '../lib/logger';

export const createUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
  role: z.nativeEnum(Role),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.nativeEnum(Role).optional(),
  password: z.string().min(8).max(128).optional(),
  isActive: z.boolean().optional(),
});

export const assignFacilitiesSchema = z.object({
  facilityIds: z.array(z.string()),
});

export const listUsers = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      facilities: { select: { facilityId: true, facility: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ users });
};

export const createUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { email, password, name, role } = req.body as z.infer<typeof createUserSchema>;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: 'A user with this email already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, name, role },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  logger.info({ event: 'user_created', userId: user.id, email: user.email, role });
  res.status(201).json({ user });
};

export const updateUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, role, password, isActive } = req.body as z.infer<typeof updateUserSchema>;

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (role !== undefined) updateData.role = role;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (password !== undefined && password !== null) updateData.passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  res.json({ user });
};

export const deleteUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  // Prevent deleting yourself
  if (req.user?.id === id) {
    res.status(400).json({ error: 'You cannot delete your own account' });
    return;
  }

  await prisma.user.delete({ where: { id } });
  res.json({ message: 'User deleted' });
};

export const assignFacilities = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { facilityIds } = req.body as z.infer<typeof assignFacilitiesSchema>;

  // Replace all facility assignments for this user
  await prisma.$transaction([
    prisma.userFacility.deleteMany({ where: { userId: id } }),
    prisma.userFacility.createMany({
      data: facilityIds.map((facilityId) => ({ userId: id, facilityId })),
      skipDuplicates: true,
    }),
  ]);

  res.json({ message: 'Facility access updated' });
};
