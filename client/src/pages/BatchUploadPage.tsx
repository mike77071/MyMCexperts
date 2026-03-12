import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  batchUploadContracts,
  getContractMatrix,
  reprocessContract,
  reprocessAllFailed,
  getQueueStatus,
  getFacility,
} from '../services/api';
import type { ContractStatus, QueueStatus, BatchUploadResult } from '../types';

const PAYER_TYPES = [
  'Medicare Advantage',
  'Medicaid MCO',
  'Commercial',
  'Workers Comp',
  'Auto',
  'Other',
];

const MAX_FILES = 10;
const MAX_TOTAL_MB = 50;
const MAX_FILE_MB = 20;

// ── File entry (pre-upload) ──────────────────────────────────────────────────

interface FileEntry {
  id: string;
  file: File;
  payerName: string;
  payerType: string;
  effectiveDate: string;
  expirationDate: string;
  error?: string; // client-side validation error
}

// ── Contract row (post-upload, in queue) ─────────────────────────────────────

interface QueuedContract {
  contractId: string;
  filename: string;
  payerName: string;
  status: ContractStatus;
  errorMessage: string | null;
  queuePosition: number;
  retryCount: number;
  uploadError?: string; // for contracts that failed at upload time (e.g. encrypted)
}

// ── Status helpers ───────────────────────────────────────────────────────────

function statusLabel(status: ContractStatus, queuePos: number): string {
  switch (status) {
    case 'PENDING':
      return queuePos > 0 ? `Queued (${queuePos})` : 'Queued';
    case 'PROCESSING_TEXT':
      return 'Reading PDF…';
    case 'PROCESSING_OCR':
      return 'Running OCR…';
    case 'PROCESSING_AI':
      return 'Extracting with AI…';
    case 'COMPLETE':
      return 'Complete';
    case 'ERROR':
      return 'Error';
    default:
      return status;
  }
}

function statusColor(status: ContractStatus): string {
  switch (status) {
    case 'PENDING':
      return 'bg-gray-100 text-gray-600';
    case 'PROCESSING_TEXT':
    case 'PROCESSING_OCR':
      return 'bg-blue-100 text-blue-700';
    case 'PROCESSING_AI':
      return 'bg-purple-100 text-purple-700';
    case 'COMPLETE':
      return 'bg-green-100 text-green-700';
    case 'ERROR':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function statusProgress(status: ContractStatus): number {
  switch (status) {
    case 'PENDING': return 0;
    case 'PROCESSING_TEXT': return 25;
    case 'PROCESSING_OCR': return 45;
    case 'PROCESSING_AI': return 70;
    case 'COMPLETE': return 100;
    case 'ERROR': return 0;
    default: return 0;
  }
}

function isProcessing(status: ContractStatus): boolean {
  return ['PENDING', 'PROCESSING_TEXT', 'PROCESSING_OCR', 'PROCESSING_AI'].includes(status);
}

// ── Error messages (user-friendly) ───────────────────────────────────────────

function friendlyError(errorMessage: string | null, uploadError?: string): {
  title: string;
  detail: string;
  instructions?: string[];
} {
  const msg = uploadError || errorMessage || '';

  if (msg.includes('PDF_ENCRYPTED')) {
    return {
      title: 'This PDF is encrypted by the health plan',
      detail: 'The file is password-protected or copy-locked and cannot be read.',
      instructions: [
        'Open the PDF on your computer using Adobe Acrobat or your default PDF viewer.',
        "Go to File → Print, then choose 'Save as PDF' or 'Microsoft Print to PDF' as the printer.",
        'Save the new copy to your computer.',
        'Re-upload that new copy.',
      ],
    };
  }
  if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('ETIMEDOUT')) {
    return {
      title: 'Processing timed out',
      detail: 'The AI extraction took too long. This usually resolves on retry.',
    };
  }
  if (msg.includes('rate') || msg.includes('429')) {
    return {
      title: 'Rate limit reached',
      detail: 'Too many requests to the AI service. The contract will be retried automatically.',
    };
  }
  if (msg.includes('schema') || msg.includes('JSON')) {
    return {
      title: 'AI extraction error',
      detail: 'The AI returned an unexpected response format. Try reprocessing.',
    };
  }
  if (msg.includes('Could not read') || msg.includes('unreadable')) {
    return {
      title: 'Unreadable document',
      detail: 'Could not extract any text from this PDF. It may be a poor quality scan or image-only document.',
    };
  }

  return {
    title: 'Processing failed',
    detail: msg || 'An unexpected error occurred during processing.',
  };
}

// ── Main component ───────────────────────────────────────────────────────────

export function BatchUploadPage() {
  const { facilityId } = useParams<{ facilityId: string }>();
  const navigate = useNavigate();

  // Facility info
  const [facilityName, setFacilityName] = useState('');

  // Pre-upload state
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Post-upload queue state
  const [queuedContracts, setQueuedContracts] = useState<QueuedContract[]>([]);
  const [userQuota, setUserQuota] = useState<QueueStatus['user'] | null>(null);

  // UI state
  const [filter, setFilter] = useState<'all' | 'processing' | 'complete' | 'error'>('all');
  const [errorDetailId, setErrorDetailId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  // ── Load facility name and queue limits on mount ─────────────────────────
  useEffect(() => {
    if (!facilityId) return;
    getFacility(facilityId)
      .then((res) => setFacilityName(res.data.facility.name))
      .catch(() => {});
    getQueueStatus()
      .then((res) => setUserQuota(res.data.user))
      .catch(() => {});
  }, [facilityId]);

  // ── Poll queued contracts every 3s ───────────────────────────────────────
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const activeContracts = queuedContracts.filter(
      (c) => !c.uploadError && isProcessing(c.status)
    );
    if (activeContracts.length === 0) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }

    const poll = async () => {
      const updates = await Promise.allSettled(
        activeContracts.map((c) => getContractMatrix(c.contractId))
      );

      setQueuedContracts((prev) =>
        prev.map((c) => {
          if (c.uploadError) return c;
          const idx = activeContracts.findIndex((a) => a.contractId === c.contractId);
          if (idx === -1) return c;

          const result = updates[idx];
          if (result.status === 'fulfilled') {
            const data = result.value.data.contract;
            return {
              ...c,
              status: data.status,
              errorMessage: data.errorMessage,
              queuePosition: data.queuePosition ?? 0,
              retryCount: data.retryCount ?? c.retryCount,
            };
          }
          return c;
        })
      );

      // Also refresh user quota
      getQueueStatus()
        .then((res) => setUserQuota(res.data.user))
        .catch(() => {});
    };

    poll(); // immediate first poll
    pollingRef.current = setInterval(poll, 3000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [
    queuedContracts.filter((c) => !c.uploadError && isProcessing(c.status)).map((c) => c.contractId).join(','),
  ]);

  // ── File selection / drag-and-drop ───────────────────────────────────────
  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const filesArr = Array.from(newFiles).filter((f) => f.type === 'application/pdf');

    setFileEntries((prev) => {
      const remaining = MAX_FILES - prev.length;
      const toAdd = filesArr.slice(0, remaining);

      const entries: FileEntry[] = toAdd.map((file) => ({
        id: crypto.randomUUID(),
        file,
        payerName: '',
        payerType: '',
        effectiveDate: '',
        expirationDate: '',
        error:
          file.size > MAX_FILE_MB * 1024 * 1024
            ? `File exceeds ${MAX_FILE_MB}MB limit`
            : undefined,
      }));

      return [...prev, ...entries];
    });
  }, []);

  const removeFile = (id: string) => {
    setFileEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const updateEntry = (id: string, field: keyof FileEntry, value: string) => {
    setFileEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  // ── Computed values ────────────────────────────────────────────────────────
  const totalBytes = fileEntries.reduce((sum, e) => sum + e.file.size, 0);
  const totalMB = totalBytes / 1024 / 1024;
  const hasValidationErrors = fileEntries.some((e) => e.error);
  const allMetadataFilled = fileEntries.every((e) => e.payerName && e.payerType);
  const canUpload =
    fileEntries.length > 0 &&
    !uploading &&
    !hasValidationErrors &&
    allMetadataFilled &&
    totalMB <= MAX_TOTAL_MB;

  // ── Upload handler ─────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!facilityId || !canUpload) return;

    setUploading(true);
    setUploadError('');

    const formData = new FormData();
    fileEntries.forEach((e) => formData.append('pdfs', e.file));
    formData.append('payerNames', JSON.stringify(fileEntries.map((e) => e.payerName)));
    formData.append('payerTypes', JSON.stringify(fileEntries.map((e) => e.payerType)));
    formData.append(
      'effectiveDates',
      JSON.stringify(fileEntries.map((e) => e.effectiveDate || null))
    );
    formData.append(
      'expirationDates',
      JSON.stringify(fileEntries.map((e) => e.expirationDate || null))
    );

    try {
      const res = await batchUploadContracts(facilityId, formData);
      const results: BatchUploadResult[] = res.data.contracts;

      // Convert results to queued contracts
      const queued: QueuedContract[] = results.map((r) => ({
        contractId: r.contractId,
        filename: r.filename,
        payerName: r.payerName,
        status: (r.error ? 'ERROR' : r.status) as ContractStatus,
        errorMessage: null,
        queuePosition: r.queuePosition,
        retryCount: 0,
        uploadError: r.error,
      }));

      setQueuedContracts((prev) => [...queued, ...prev]);
      setFileEntries([]); // clear the upload form
    } catch (err: unknown) {
      const errData = (err as { response?: { data?: { message?: string; error?: string } } })
        ?.response?.data;
      setUploadError(errData?.message || errData?.error || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // ── Retry handlers ─────────────────────────────────────────────────────────
  const handleRetry = async (contractId: string) => {
    setRetrying((prev) => new Set(prev).add(contractId));
    try {
      await reprocessContract(contractId);
      setQueuedContracts((prev) =>
        prev.map((c) =>
          c.contractId === contractId
            ? { ...c, status: 'PENDING' as ContractStatus, errorMessage: null, queuePosition: 1 }
            : c
        )
      );
    } catch {
      // Error handling - the queue grid will show the unchanged error state
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev);
        next.delete(contractId);
        return next;
      });
    }
  };

  const handleRetryAll = async () => {
    if (!facilityId) return;
    try {
      const res = await reprocessAllFailed(facilityId);
      const requeuedIds: string[] = res.data.contractIds ?? [];
      setQueuedContracts((prev) =>
        prev.map((c) =>
          requeuedIds.includes(c.contractId)
            ? { ...c, status: 'PENDING' as ContractStatus, errorMessage: null, queuePosition: 1 }
            : c
        )
      );
    } catch {}
  };

  const clearCompleted = () => {
    setQueuedContracts((prev) => prev.filter((c) => c.status !== 'COMPLETE'));
  };

  // ── Filtered queue ─────────────────────────────────────────────────────────
  const filteredContracts = queuedContracts.filter((c) => {
    if (filter === 'processing') return isProcessing(c.status);
    if (filter === 'complete') return c.status === 'COMPLETE';
    if (filter === 'error') return c.status === 'ERROR' || c.uploadError;
    return true;
  });

  const summary = {
    total: queuedContracts.length,
    complete: queuedContracts.filter((c) => c.status === 'COMPLETE').length,
    processing: queuedContracts.filter((c) => isProcessing(c.status)).length,
    errors: queuedContracts.filter((c) => c.status === 'ERROR' || c.uploadError).length,
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500">
        <Link to="/facilities" className="hover:text-brand-600">
          Facilities
        </Link>
        <span className="mx-2">/</span>
        <Link to={`/facilities/${facilityId}`} className="hover:text-brand-600">
          {facilityName || 'Facility'}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">Upload Contracts</span>
      </nav>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Upload Contracts</h1>
        {userQuota && (
          <span className="text-sm text-gray-500">
            {userQuota.inFlight} of {userQuota.limit} slots in use
            <span className="mx-1.5 text-gray-300">|</span>
            {userQuota.remaining} available
          </span>
        )}
      </div>

      {/* ── Upload Zone ─────────────────────────────────────────────────────── */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          dragOver
            ? 'border-brand-500 bg-brand-50'
            : 'border-gray-300 bg-white hover:border-gray-400'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="text-gray-500">
          <svg
            className="mx-auto h-10 w-10 text-gray-400 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 3.75 3.75 0 013.57 4.904A4.5 4.5 0 0118 19.5H6.75z"
            />
          </svg>
          <p className="text-sm font-medium text-gray-700">
            Drag & drop PDF files here, or{' '}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-brand-600 hover:text-brand-700 underline"
            >
              browse files
            </button>
          </p>
          <p className="text-xs text-gray-400 mt-1.5">
            Up to {MAX_FILES} files &middot; {MAX_TOTAL_MB}MB total &middot; {MAX_FILE_MB}MB per file &middot; PDF only
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = ''; // allow re-selecting same files
          }}
        />
      </div>

      {/* ── Pre-upload file list ────────────────────────────────────────────── */}
      {fileEntries.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="text-sm font-medium text-gray-700">
              <span className="text-brand-600 font-semibold">{fileEntries.length}</span> of{' '}
              {MAX_FILES} files selected
              <span className="mx-2 text-gray-300">|</span>
              {totalMB.toFixed(1)} MB of {MAX_TOTAL_MB} MB
            </div>
            {totalMB > MAX_TOTAL_MB && (
              <span className="text-xs text-red-600 font-medium">
                Total size exceeds {MAX_TOTAL_MB}MB limit
              </span>
            )}
          </div>

          <div className="divide-y divide-gray-100">
            {fileEntries.map((entry) => (
              <div key={entry.id} className="px-5 py-3 flex items-start gap-4">
                {/* File info */}
                <div className="flex-shrink-0 w-56">
                  <p className="text-sm font-medium text-gray-800 truncate" title={entry.file.name}>
                    {entry.file.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {(entry.file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  {entry.error && (
                    <p className="text-xs text-red-500 mt-0.5">{entry.error}</p>
                  )}
                </div>

                {/* Metadata fields */}
                <div className="flex-1 grid grid-cols-4 gap-3">
                  <input
                    type="text"
                    placeholder="Payer name *"
                    value={entry.payerName}
                    onChange={(e) => updateEntry(entry.id, 'payerName', e.target.value)}
                    className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <select
                    value={entry.payerType}
                    onChange={(e) => updateEntry(entry.id, 'payerType', e.target.value)}
                    className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                  >
                    <option value="">Payer type *</option>
                    {PAYER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={entry.effectiveDate}
                    onChange={(e) => updateEntry(entry.id, 'effectiveDate', e.target.value)}
                    title="Effective date (optional)"
                    className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <input
                    type="date"
                    value={entry.expirationDate}
                    onChange={(e) => updateEntry(entry.id, 'expirationDate', e.target.value)}
                    title="Expiration date (optional)"
                    className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Remove button */}
                <button
                  onClick={() => removeFile(entry.id)}
                  className="flex-shrink-0 text-gray-400 hover:text-red-500 p-1"
                  title="Remove file"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Upload button bar */}
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50">
            {uploadError && (
              <p className="text-sm text-red-600">{uploadError}</p>
            )}
            <div className="flex items-center gap-3 ml-auto">
              <button
                onClick={() => setFileEntries([])}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Clear all
              </button>
              <button
                onClick={handleUpload}
                disabled={!canUpload}
                className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-6 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading
                  ? 'Uploading…'
                  : `Upload All (${fileEntries.length} file${fileEntries.length !== 1 ? 's' : ''})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Queue Grid ──────────────────────────────────────────────────────── */}
      {queuedContracts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Summary bar */}
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {summary.total} contract{summary.total !== 1 ? 's' : ''}:
              {summary.complete > 0 && (
                <span className="ml-2 text-green-600">{summary.complete} complete</span>
              )}
              {summary.processing > 0 && (
                <span className="ml-2 text-blue-600">{summary.processing} processing</span>
              )}
              {summary.errors > 0 && (
                <span className="ml-2 text-red-600">{summary.errors} error{summary.errors !== 1 ? 's' : ''}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {summary.errors > 0 && (
                <button
                  onClick={handleRetryAll}
                  className="text-xs font-medium text-red-600 hover:text-red-700 px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
                >
                  Retry All Failed
                </button>
              )}
              {summary.complete > 0 && (
                <button
                  onClick={clearCompleted}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  Clear Completed
                </button>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="px-5 py-2 border-b border-gray-100 flex gap-1">
            {(['all', 'processing', 'complete', 'error'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${
                  filter === f
                    ? 'bg-brand-100 text-brand-700'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}
              >
                {f === 'all'
                  ? `All (${summary.total})`
                  : f === 'processing'
                  ? `Processing (${summary.processing})`
                  : f === 'complete'
                  ? `Complete (${summary.complete})`
                  : `Errors (${summary.errors})`}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-5 py-2.5">File</th>
                  <th className="px-5 py-2.5">Payer</th>
                  <th className="px-5 py-2.5">Status</th>
                  <th className="px-5 py-2.5">Progress</th>
                  <th className="px-5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredContracts.map((c) => {
                  const pct = statusProgress(c.status);
                  const isError = c.status === 'ERROR' || !!c.uploadError;

                  return (
                    <tr
                      key={c.contractId || c.filename}
                      className={isError ? 'bg-red-50/50' : ''}
                    >
                      <td className="px-5 py-3">
                        <span className="font-medium text-gray-800 truncate block max-w-[200px]" title={c.filename}>
                          {c.filename}
                        </span>
                        {c.retryCount > 0 && (
                          <span className="text-xs text-gray-400">Retry #{c.retryCount}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-600">{c.payerName}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${statusColor(
                            c.status
                          )} ${isProcessing(c.status) ? 'animate-pulse' : ''}`}
                        >
                          {isProcessing(c.status) && (
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          )}
                          {c.status === 'COMPLETE' && (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          {statusLabel(c.status, c.queuePosition)}
                        </span>
                      </td>
                      <td className="px-5 py-3 w-40">
                        {!isError && (
                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all duration-500 ${
                                c.status === 'COMPLETE'
                                  ? 'bg-green-500'
                                  : c.status === 'PROCESSING_AI'
                                  ? 'bg-purple-500'
                                  : 'bg-blue-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {c.status === 'COMPLETE' && c.contractId && (
                            <button
                              onClick={() => navigate(`/contracts/${c.contractId}/matrix`)}
                              className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            >
                              View
                            </button>
                          )}
                          {isError && c.contractId && !c.uploadError && (
                            <>
                              <button
                                onClick={() => setErrorDetailId(
                                  errorDetailId === c.contractId ? null : c.contractId
                                )}
                                className="text-xs font-medium text-gray-500 hover:text-gray-700"
                              >
                                Details
                              </button>
                              <button
                                onClick={() => handleRetry(c.contractId)}
                                disabled={retrying.has(c.contractId)}
                                className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                              >
                                {retrying.has(c.contractId) ? 'Retrying…' : 'Retry'}
                              </button>
                            </>
                          )}
                          {isError && c.uploadError && (
                            <button
                              onClick={() => setErrorDetailId(
                                errorDetailId === (c.contractId || c.filename) ? null : (c.contractId || c.filename)
                              )}
                              className="text-xs font-medium text-gray-500 hover:text-gray-700"
                            >
                              Details
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Error detail panel (inline below the table) */}
          {errorDetailId && (() => {
            const contract = queuedContracts.find(
              (c) => c.contractId === errorDetailId || c.filename === errorDetailId
            );
            if (!contract) return null;

            const err = friendlyError(contract.errorMessage, contract.uploadError);

            return (
              <div className="border-t border-red-200 bg-red-50 px-6 py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-red-800">{err.title}</h4>
                    <p className="text-sm text-red-700 mt-1">{err.detail}</p>
                    {err.instructions && (
                      <ol className="mt-3 space-y-1 text-sm text-red-700 list-decimal list-inside">
                        {err.instructions.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                  <button
                    onClick={() => setErrorDetailId(null)}
                    className="text-red-400 hover:text-red-600 p-1"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {contract.contractId && !contract.uploadError && (
                  <button
                    onClick={() => handleRetry(contract.contractId)}
                    disabled={retrying.has(contract.contractId)}
                    className="mt-3 bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {retrying.has(contract.contractId) ? 'Retrying…' : 'Retry Processing'}
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Empty state */}
      {fileEntries.length === 0 && queuedContracts.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          Drag PDFs into the upload zone above to get started.
        </div>
      )}
    </div>
  );
}
