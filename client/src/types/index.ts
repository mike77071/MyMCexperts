export type Role = 'ADMIN' | 'CASE_MANAGER' | 'BILLER' | 'VIEWER';

export type ContractStatus =
  | 'PENDING'
  | 'PROCESSING_TEXT'
  | 'PROCESSING_OCR'
  | 'PROCESSING_AI'
  | 'COMPLETE'
  | 'ERROR';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Facility {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  npi: string | null;
  phone: string | null;
  createdAt: string;
  _count?: { contracts: number };
}

export interface Contract {
  id: string;
  payerName: string;
  payerType: string;
  effectiveDate: string | null;
  expirationDate: string | null;
  originalFilename: string;
  status: ContractStatus;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  createdBy: string;
  facility?: { id: string; name: string };
  queuePosition?: number;
}

// ── Batch upload types ───────────────────────────────────────────────────────

export interface BatchUploadResult {
  contractId: string;
  filename: string;
  payerName: string;
  status: string;
  queuePosition: number;
  error?: string;
}

export interface BatchUploadResponse {
  uploaded: number;
  failed: number;
  total: number;
  contracts: BatchUploadResult[];
}

export interface QueueStatus {
  queue: {
    processing: number;
    waiting: number;
    concurrency: number;
    queuedIds: string[];
  };
  user: {
    inFlight: number;
    remaining: number;
    limit: number;
  };
  limits: {
    maxBatchFiles: number;
    maxBatchMB: number;
    maxFileMB: number;
  };
}

// ── Matrix types ──────────────────────────────────────────────────────────────

export interface PerDiemRate {
  levelOfCare: string;
  ratePerDay: number | null;
  notes: string | null;
}

export interface ProcedureCode {
  code: string;
  description: string;
  rate: number | null;
  unit: string | null;
}

export interface AncillaryService {
  service: string;
  reimbursementBasis: string | null;
  notes: string | null;
}

export interface ContractMatrix {
  payerInfo: {
    payerName: string | null;
    payerType: string | null;
    contractEffectiveDate: string | null;
    contractExpirationDate: string | null;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    providerRelationsPhone: string | null;
  };
  reimbursementRates: {
    perDiemRates: PerDiemRate[];
    pdpmOrRugNotes: string | null;
    procedureCodes: ProcedureCode[];
    ancillaryServices: AncillaryService[];
    otherRates: string | null;
  };
  coveredServices: {
    included: string[];
    excluded: string[];
    notes: string | null;
  };
  authorizationRequirements: {
    requiresPriorAuth: string[];
    initialAuthDays: string | null;
    concurrentReviewFrequency: string | null;
    authContactPhone: string | null;
    notes: string | null;
  };
  timelyFiling: {
    initialClaimDays: number | null;
    correctedClaimDays: number | null;
    appealDays: number | null;
    notes: string | null;
  };
  extractionMetadata: {
    confidence: 'high' | 'medium' | 'low';
    missingFields: string[];
    warnings: string[];
  };
}
