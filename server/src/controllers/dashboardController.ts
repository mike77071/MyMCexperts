import { Response } from 'express';
import { Role, ContractStatus } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/authenticate';
import prisma from '../lib/prismaClient';

const PROCESSING_STATUSES: ContractStatus[] = [
  ContractStatus.PENDING,
  ContractStatus.PROCESSING_TEXT,
  ContractStatus.PROCESSING_OCR,
  ContractStatus.PROCESSING_AI,
];

export const getDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const isAdmin = req.user?.role === Role.ADMIN;
  const userId = req.user!.id;

  const userFilter = isAdmin ? {} : { facility: { users: { some: { userId } } } };

  const now = new Date();
  const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const [
    totalContracts,
    processingCount,
    errorCount,
    facilitiesCount,
    expiringContracts,
    recentContracts,
  ] = await Promise.all([
    prisma.contract.count({ where: userFilter }),
    prisma.contract.count({ where: { ...userFilter, status: { in: PROCESSING_STATUSES } } }),
    prisma.contract.count({ where: { ...userFilter, status: ContractStatus.ERROR } }),
    isAdmin
      ? prisma.facility.count()
      : prisma.facility.count({ where: { users: { some: { userId } } } }),
    prisma.contract.findMany({
      where: { ...userFilter, expirationDate: { gte: now, lte: in90Days } },
      select: {
        id: true,
        payerName: true,
        payerType: true,
        expirationDate: true,
        facility: { select: { id: true, name: true } },
      },
      orderBy: { expirationDate: 'asc' },
      take: 15,
    }),
    prisma.contract.findMany({
      where: userFilter,
      select: {
        id: true,
        payerName: true,
        payerType: true,
        status: true,
        createdAt: true,
        facility: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
  ]);

  const expiringWithDays = expiringContracts.map((c) => {
    const daysUntilExpiry = Math.ceil(
      (c.expirationDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    return { ...c, expirationDate: c.expirationDate!.toISOString(), daysUntilExpiry };
  });

  res.json({
    stats: {
      totalContracts,
      processingCount,
      errorCount,
      facilitiesCount,
      expiringRed: expiringWithDays.filter((c) => c.daysUntilExpiry <= 30).length,
      expiringAmber: expiringWithDays.filter((c) => c.daysUntilExpiry > 30 && c.daysUntilExpiry <= 60).length,
      expiringYellow: expiringWithDays.filter((c) => c.daysUntilExpiry > 60).length,
    },
    expiringContracts: expiringWithDays,
    recentContracts: recentContracts.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
  });
};
