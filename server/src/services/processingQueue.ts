import { processContract } from './pdfService';
import prisma from '../lib/prismaClient';
import logger from '../lib/logger';

// ── Queue configuration ──────────────────────────────────────────────────────
// Process 2 contracts at a time to balance throughput vs resource usage.
// OCR is CPU-heavy, Claude API has rate limits — 2 concurrent is the sweet spot.
const CONCURRENCY = 2;

// p-queue is ESM-only, so we lazy-load it via dynamic import.
// The queue instance is created once and cached.
let _queue: any | null = null;

async function getQueue(): Promise<any> {
  if (_queue) return _queue;
  const { default: PQueue } = await import('p-queue');
  _queue = new PQueue({ concurrency: CONCURRENCY });
  return _queue;
}

// Track queue positions for status reporting
const queuedContractIds: string[] = [];

/**
 * Add a contract to the processing queue.
 * Returns the queue position (1-based).
 */
export function enqueueContract(contractId: string): number {
  queuedContractIds.push(contractId);
  const position = queuedContractIds.length;

  logger.info({
    event: 'contract_enqueued',
    contractId,
    position,
  });

  // Kick off async queue add (non-blocking)
  getQueue()
    .then((queue) =>
      queue.add(async () => {
        // Remove from tracked queue when processing starts
        const idx = queuedContractIds.indexOf(contractId);
        if (idx !== -1) queuedContractIds.splice(idx, 1);

        await processContract(contractId);
      })
    )
    .catch((err: unknown) => {
      logger.error({
        event: 'queue_process_error',
        contractId,
        error: String(err),
      });
    });

  return position;
}

/**
 * Get the current queue position for a contract (0 = not in queue / already processing).
 */
export function getQueuePosition(contractId: string): number {
  const idx = queuedContractIds.indexOf(contractId);
  return idx === -1 ? 0 : idx + 1;
}

/**
 * Get queue stats for the status endpoint.
 */
export function getQueueStats() {
  return {
    processing: _queue?.pending ?? 0,
    waiting: _queue?.size ?? 0,
    concurrency: CONCURRENCY,
    queuedIds: [...queuedContractIds],
  };
}

/**
 * Check how many contracts a user currently has in PENDING or PROCESSING states.
 * Used to enforce the per-user throttle (max 20 in-flight).
 */
export async function getUserInFlightCount(userId: string): Promise<number> {
  return prisma.contract.count({
    where: {
      createdById: userId,
      status: {
        in: ['PENDING', 'PROCESSING_TEXT', 'PROCESSING_OCR', 'PROCESSING_AI'],
      },
    },
  });
}

export const MAX_BATCH_FILES = 10;
export const MAX_BATCH_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_USER_IN_FLIGHT = 20;
