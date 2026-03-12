import { useEffect, useState, useRef, FormEvent, Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
  getContracts,
  deleteContract,
  getFacilities,
  uploadContract,
  reprocessContract,
  reprocessAllFailed,
  getExportUrl,
} from '../services/api';
import { ContractStatus, Facility } from '../types';
import { useAuth } from '../hooks/useAuth';

interface ContractRow {
  id: string;
  payerName: string;
  payerType: string;
  status: ContractStatus;
  errorMessage: string | null;
  originalFilename?: string;
  retryCount?: number;
  effectiveDate: string | null;
  expirationDate: string | null;
  createdAt: string;
  facility: { id: string; name: string };
  createdBy: { id: string; name: string };
  matrix?: { extractedAt: string } | null;
}

const STATUS_BADGE: Record<ContractStatus, { label: string; className: string }> = {
  PENDING:         { label: 'Queued',       className: 'bg-gray-100 text-gray-600' },
  PROCESSING_TEXT: { label: 'Reading PDF',  className: 'bg-blue-100 text-blue-700' },
  PROCESSING_OCR:  { label: 'Running OCR',  className: 'bg-blue-100 text-blue-700' },
  PROCESSING_AI:   { label: 'AI Extract',   className: 'bg-purple-100 text-purple-700' },
  COMPLETE:        { label: 'Complete',     className: 'bg-green-100 text-green-700' },
  ERROR:           { label: 'Error',        className: 'bg-red-100 text-red-700' },
};

const STATUS_LABELS: [ContractStatus, string][] = [
  ['PENDING', 'Queued'],
  ['PROCESSING_TEXT', 'Reading PDF'],
  ['PROCESSING_OCR', 'Running OCR'],
  ['PROCESSING_AI', 'AI Extract'],
  ['COMPLETE', 'Complete'],
  ['ERROR', 'Error'],
];

const PAYER_TYPES = ['Medicare Advantage', 'Medicaid MCO', 'Commercial', 'Workers Comp', 'Auto', 'Other'];

type SortCol = 'payerName' | 'facility' | 'status' | 'lastUpdated' | 'uploadedBy' | 'versions' | 'expirationDate';
type SortDir = 'asc' | 'desc';

type EncryptedError = { message: string; instructions: string[] };

function isProcessing(status: ContractStatus): boolean {
  return ['PENDING', 'PROCESSING_TEXT', 'PROCESSING_OCR', 'PROCESSING_AI'].includes(status);
}

function statusProgress(status: ContractStatus): number {
  switch (status) {
    case 'PENDING': return 5;
    case 'PROCESSING_TEXT': return 25;
    case 'PROCESSING_OCR': return 45;
    case 'PROCESSING_AI': return 70;
    case 'COMPLETE': return 100;
    default: return 0;
  }
}

function friendlyError(msg: string | null): { title: string; detail: string; instructions?: string[] } {
  const m = msg || '';
  if (m.includes('PDF_ENCRYPTED') || m.includes('encrypted') || m.includes('copy-protected')) {
    return {
      title: 'This PDF is encrypted by the health plan',
      detail: 'The file is password-protected or copy-locked and cannot be read.',
      instructions: [
        'Open the PDF on your computer using Adobe Acrobat or your default PDF viewer.',
        "Go to File → Print, then choose 'Save as PDF' or 'Microsoft Print to PDF' as the printer.",
        'Save the new copy to your computer.',
        'Delete this contract and re-upload the new copy.',
      ],
    };
  }
  if (m.includes('OCR') || m.includes('ocr') || m.includes('scanned') || m.includes('text quality') || m.includes('unreadable')) {
    return {
      title: 'Could not read this scanned document',
      detail: m,
      instructions: [
        'If possible, request a digital (non-scanned) copy of the contract from the payer.',
        'If only a paper copy is available, re-scan at 300 DPI or higher with a flatbed scanner.',
        'Make sure the pages are straight, well-lit, and free of shadows or creases.',
        'Click "Retry" to attempt processing again with enhanced OCR.',
      ],
    };
  }
  if (m.includes('timeout') || m.includes('Timeout') || m.includes('ETIMEDOUT')) {
    return {
      title: 'Processing timed out',
      detail: 'The AI extraction took too long to complete. This is usually temporary.',
      instructions: [
        'Click "Retry" to reprocess — it typically works on the second attempt.',
        'If it fails again, the contract PDF may be unusually long. Try splitting it into smaller sections.',
      ],
    };
  }
  if (m.includes('rate') || m.includes('429') || m.includes('Too Many')) {
    return {
      title: 'AI service rate limit reached',
      detail: 'Too many contracts are being processed at once. Your contract will be retried shortly.',
      instructions: [
        'Wait a few minutes and click "Retry".',
        'The processing queue automatically spaces out requests to avoid this.',
      ],
    };
  }
  if (m.includes('schema') || m.includes('JSON') || m.includes('unexpected')) {
    return {
      title: 'AI returned an unexpected response',
      detail: 'The AI extraction completed but the results could not be parsed correctly.',
      instructions: [
        'Click "Retry" — this is usually a one-time issue.',
        'If it persists, the contract may contain unusual formatting that confuses the AI.',
      ],
    };
  }
  if (m.includes('FILE_MISSING') || m.includes('no longer available')) {
    return {
      title: 'Original PDF file is missing',
      detail: 'The uploaded PDF can no longer be found on the server.',
      instructions: [
        'This can happen if the server storage was cleaned up.',
        'Delete this contract and re-upload the PDF.',
      ],
    };
  }
  return {
    title: 'Processing failed',
    detail: m || 'An unexpected error occurred during contract processing.',
    instructions: [
      'Click "Retry" to attempt processing again.',
      'If the issue persists, try re-uploading the contract PDF.',
    ],
  };
}

function getLastUpdated(c: ContractRow): string {
  return c.matrix?.extractedAt ?? c.createdAt;
}

function buildVersionMap(contracts: ContractRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of contracts) {
    const key = `${c.payerName.toLowerCase()}:${c.facility.id}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

export function ContractsPage() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchPayor, setSearchPayor] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFacility, setFilterFacility] = useState('');
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir }>({ col: 'lastUpdated', dir: 'desc' });

  // Upload modal state
  const [showUpload, setShowUpload] = useState(false);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [uploadFacilityId, setUploadFacilityId] = useState('');
  const [payerName, setPayerName] = useState('');
  const [payerType, setPayerType] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [encryptedError, setEncryptedError] = useState<EncryptedError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Queue UI state
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [errorDetailId, setErrorDetailId] = useState<string | null>(null);

  const canUpload = user?.role === 'ADMIN' || user?.role === 'CASE_MANAGER';

  const reload = () =>
    getContracts()
      .then((res) => setContracts(res.data.contracts))
      .finally(() => setLoading(false));

  useEffect(() => { reload(); }, []);

  // ── Auto-poll every 3s if any contracts are processing ─────────────────
  const hasProcessing = contracts.some((c) => isProcessing(c.status));
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!hasProcessing) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }
    pollingRef.current = setInterval(() => {
      getContracts()
        .then((res) => setContracts(res.data.contracts))
        .catch(() => {});
    }, 3000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [hasProcessing]);

  // ── Retry handlers ─────────────────────────────────────────────────────
  const handleRetry = async (id: string) => {
    setRetrying((prev) => new Set(prev).add(id));
    try {
      await reprocessContract(id);
      // Optimistic update
      setContracts((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: 'PENDING' as ContractStatus, errorMessage: null } : c
        )
      );
    } catch {
      // Status stays as ERROR
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleRetryAllForFacility = async (facilityId: string) => {
    try {
      await reprocessAllFailed(facilityId);
      reload();
    } catch {}
  };

  const openUpload = async () => {
    if (!facilities.length) {
      const res = await getFacilities();
      setFacilities(res.data.facilities);
    }
    setUploadFacilityId('');
    setPayerName('');
    setPayerType('');
    setEffectiveDate('');
    setExpirationDate('');
    setFile(null);
    setUploadError('');
    setEncryptedError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setShowUpload(true);
  };

  const handleUploadSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !uploadFacilityId) return;
    setUploadError('');
    setEncryptedError(null);
    setUploading(true);
    const formData = new FormData();
    formData.append('pdf', file);
    formData.append('payerName', payerName);
    formData.append('payerType', payerType);
    if (effectiveDate) formData.append('effectiveDate', effectiveDate);
    if (expirationDate) formData.append('expirationDate', expirationDate);
    try {
      await uploadContract(uploadFacilityId, formData);
      setShowUpload(false);
      setLoading(true);
      reload();
    } catch (err: unknown) {
      const errData = (err as { response?: { data?: { error?: string; message?: string; instructions?: string[] } } })
        ?.response?.data;
      if (errData?.error === 'PDF_ENCRYPTED') {
        setEncryptedError({ message: errData.message ?? 'PDF encrypted.', instructions: errData.instructions ?? [] });
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        setUploadError(errData?.message ?? 'Upload failed. Please try again.');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete contract "${name}"? This cannot be undone.`)) return;
    await deleteContract(id);
    reload();
  };

  const handleSort = (col: SortCol) => {
    setSort((s) => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  };

  const versionMap = buildVersionMap(contracts);

  const filtered = contracts.filter((c) => {
    if (searchPayor && !c.payerName.toLowerCase().includes(searchPayor.toLowerCase())) return false;
    if (filterStatus && c.status !== filterStatus) return false;
    if (filterFacility && c.facility.id !== filterFacility) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sort.col === 'payerName') {
      cmp = a.payerName.localeCompare(b.payerName);
    } else if (sort.col === 'facility') {
      cmp = a.facility.name.localeCompare(b.facility.name);
    } else if (sort.col === 'status') {
      cmp = a.status.localeCompare(b.status);
    } else if (sort.col === 'lastUpdated') {
      cmp = new Date(getLastUpdated(a)).getTime() - new Date(getLastUpdated(b)).getTime();
    } else if (sort.col === 'expirationDate') {
      const da = a.expirationDate ? new Date(a.expirationDate).getTime() : 0;
      const db = b.expirationDate ? new Date(b.expirationDate).getTime() : 0;
      cmp = da - db;
    } else if (sort.col === 'uploadedBy') {
      cmp = (a.createdBy?.name ?? '').localeCompare(b.createdBy?.name ?? '');
    } else if (sort.col === 'versions') {
      const va = versionMap.get(`${a.payerName.toLowerCase()}:${a.facility.id}`) ?? 1;
      const vb = versionMap.get(`${b.payerName.toLowerCase()}:${b.facility.id}`) ?? 1;
      cmp = va - vb;
    }
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  // ── Summary counts ─────────────────────────────────────────────────────
  const summary = {
    total: contracts.length,
    complete: contracts.filter((c) => c.status === 'COMPLETE').length,
    processing: contracts.filter((c) => isProcessing(c.status)).length,
    errors: contracts.filter((c) => c.status === 'ERROR').length,
  };

  // Collect unique facility IDs that have errors (for "retry all" per facility)
  const errorFacilityIds = [...new Set(
    contracts.filter((c) => c.status === 'ERROR').map((c) => c.facility.id)
  )];

  const SortIndicator = ({ col }: { col: SortCol }) =>
    sort.col !== col
      ? <span className="ml-1 text-gray-300">&#8597;</span>
      : <span className="ml-1 text-brand-600">{sort.dir === 'asc' ? '\u2191' : '\u2193'}</span>;

  const Th = ({ col, children }: { col: SortCol; children: React.ReactNode }) => (
    <th
      className="text-left px-5 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900 whitespace-nowrap"
      onClick={() => handleSort(col)}
    >
      {children}<SortIndicator col={col} />
    </th>
  );

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-8 w-8 rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contracts</h1>
          <p className="text-gray-500 text-sm mt-1">
            {summary.total} contract{summary.total !== 1 ? 's' : ''}
            {summary.processing > 0 && (
              <span className="ml-1.5 text-blue-600">
                &middot; {summary.processing} processing
              </span>
            )}
            {summary.errors > 0 && (
              <span className="ml-1.5 text-red-600">
                &middot; {summary.errors} error{summary.errors !== 1 ? 's' : ''}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {summary.errors > 0 && canUpload && (
            <div className="relative group">
              <button
                onClick={() => {
                  if (errorFacilityIds.length === 1) {
                    handleRetryAllForFacility(errorFacilityIds[0]);
                  }
                }}
                className="text-xs font-medium text-red-600 hover:text-red-700 px-3 py-2 rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
              >
                Retry All Failed ({summary.errors})
              </button>
              {errorFacilityIds.length > 1 && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 hidden group-hover:block z-10 min-w-[200px]">
                  {errorFacilityIds.map((fId) => {
                    const fac = contracts.find((c) => c.facility.id === fId)?.facility;
                    const count = contracts.filter((c) => c.facility.id === fId && c.status === 'ERROR').length;
                    return (
                      <button
                        key={fId}
                        onClick={() => handleRetryAllForFacility(fId)}
                        className="w-full text-left px-4 py-2 text-xs hover:bg-gray-50 text-gray-700"
                      >
                        {fac?.name} ({count})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {canUpload && (
            <button
              onClick={openUpload}
              className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              + Upload Contract
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-5">
        <input
          type="text"
          placeholder="Search by payer..."
          value={searchPayor}
          onChange={(e) => setSearchPayor(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-60"
        />
        <select
          value={filterFacility}
          onChange={(e) => setFilterFacility(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
        >
          <option value="">All Facilities</option>
          {[...new Map(contracts.map((c) => [c.facility.id, c.facility.name])).entries()].map(
            ([id, name]) => (
              <option key={id} value={id}>{name}</option>
            )
          )}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
        >
          <option value="">All Statuses</option>
          {STATUS_LABELS.map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        {(searchPayor || filterStatus || filterFacility) && (
          <button
            onClick={() => { setSearchPayor(''); setFilterStatus(''); setFilterFacility(''); }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Result count */}
      {(searchPayor || filterStatus || filterFacility) && sorted.length > 0 && (
        <p className="text-xs text-gray-400 mb-3">
          Showing {sorted.length} of {contracts.length} contract{contracts.length !== 1 ? 's' : ''}
        </p>
      )}

      {/* Table */}
      {sorted.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          {contracts.length === 0 ? (
            <>
              <p className="text-lg">No contracts yet.</p>
              {canUpload && <p className="text-sm mt-1">Click "+ Upload Contract" to get started.</p>}
            </>
          ) : (
            <p className="text-lg">No contracts match your filters.</p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <Th col="payerName">Payor</Th>
                  <Th col="facility">Facility</Th>
                  <Th col="status">Status</Th>
                  <th className="text-left px-5 py-3 font-medium text-gray-600 whitespace-nowrap">Progress</th>
                  <Th col="expirationDate">Expires</Th>
                  <Th col="lastUpdated">Updated</Th>
                  <Th col="uploadedBy">Uploaded By</Th>
                  <Th col="versions">Ver.</Th>
                  <th className="px-5 py-3 font-medium text-gray-600 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((c) => {
                  const badge = STATUS_BADGE[c.status];
                  const versionKey = `${c.payerName.toLowerCase()}:${c.facility.id}`;
                  const versions = versionMap.get(versionKey) ?? 1;
                  const pct = statusProgress(c.status);
                  const processing = isProcessing(c.status);
                  const isError = c.status === 'ERROR';

                  return (
                    <Fragment key={c.id}>
                    <tr
                      className={`transition-colors ${
                        isError ? 'bg-red-50/40 hover:bg-red-50/70' : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Payor */}
                      <td className="px-5 py-3">
                        <div className="font-medium text-gray-900">{c.payerName}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {c.payerType}
                          {c.originalFilename && (
                            <span> &middot; {c.originalFilename}</span>
                          )}
                        </div>
                      </td>

                      {/* Facility */}
                      <td className="px-5 py-3">
                        <Link to={`/facilities/${c.facility.id}`} className="text-gray-700 hover:text-brand-600 text-sm">
                          {c.facility.name}
                        </Link>
                      </td>

                      {/* Status badge */}
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${badge.className} ${
                            processing ? 'animate-pulse' : ''
                          }`}
                        >
                          {processing && (
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          )}
                          {c.status === 'COMPLETE' && (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          {badge.label}
                        </span>
                        {(c.retryCount ?? 0) > 0 && (
                          <span className="text-[10px] text-gray-400 ml-1.5">retry #{c.retryCount}</span>
                        )}
                      </td>

                      {/* Progress bar */}
                      <td className="px-5 py-3 w-32">
                        {!isError ? (
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
                        ) : (
                          <span className="text-xs text-red-400">--</span>
                        )}
                      </td>

                      {/* Expiration date */}
                      <td className="px-5 py-3 whitespace-nowrap">
                        {c.expirationDate ? (() => {
                          const exp = new Date(c.expirationDate);
                          const now = new Date();
                          const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / 86400000);
                          const isExpired = daysLeft < 0;
                          const isExpiringSoon = !isExpired && daysLeft <= 30;
                          return (
                            <span className={
                              isExpired ? 'text-red-600 font-medium' :
                              isExpiringSoon ? 'text-amber-600 font-medium' :
                              'text-gray-500'
                            }>
                              {exp.toLocaleDateString()}
                              {isExpired && <span className="block text-[10px]">Expired</span>}
                              {isExpiringSoon && <span className="block text-[10px]">{daysLeft}d left</span>}
                            </span>
                          );
                        })() : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>

                      {/* Last updated */}
                      <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                        {new Date(getLastUpdated(c)).toLocaleDateString()}
                      </td>

                      {/* Uploaded by */}
                      <td className="px-5 py-3 text-gray-500">{c.createdBy?.name ?? '\u2014'}</td>

                      {/* Versions */}
                      <td className="px-5 py-3 text-gray-500 text-center">{versions}</td>

                      {/* Actions */}
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-3">
                          {c.status === 'COMPLETE' && (
                            <>
                              <Link
                                to={`/contracts/${c.id}/matrix`}
                                className="text-xs text-brand-600 hover:text-brand-700 font-medium whitespace-nowrap"
                              >
                                View Matrix
                              </Link>
                              <a
                                href={getExportUrl(c.id)}
                                className="text-xs text-gray-500 hover:text-gray-700 font-medium whitespace-nowrap"
                                title="Download Excel"
                              >
                                Export
                              </a>
                            </>
                          )}
                          {isError && canUpload && (
                            <>
                              <button
                                onClick={() =>
                                  setErrorDetailId(errorDetailId === c.id ? null : c.id)
                                }
                                className="text-xs text-gray-500 hover:text-gray-700 font-medium"
                              >
                                Details
                              </button>
                              <button
                                onClick={() => handleRetry(c.id)}
                                disabled={retrying.has(c.id)}
                                className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
                              >
                                {retrying.has(c.id) ? 'Retrying...' : 'Retry'}
                              </button>
                            </>
                          )}
                          {user?.role === 'ADMIN' && (
                            <button
                              onClick={() => handleDelete(c.id, c.payerName)}
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Inline error detail row */}
                    {errorDetailId === c.id && isError && (() => {
                      const err = friendlyError(c.errorMessage);
                      return (
                        <tr>
                          <td colSpan={9} className="p-0">
                            <div className="border-t border-red-200 bg-red-50 px-6 py-4">
                              <div className="flex items-start justify-between">
                                <div>
                                  <h4 className="font-semibold text-red-800">{err.title}</h4>
                                  <p className="text-sm text-red-700 mt-1">{err.detail}</p>
                                  {err.instructions && err.instructions.length > 0 && (
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
                              {canUpload && (
                                <button
                                  onClick={() => handleRetry(c.id)}
                                  disabled={retrying.has(c.id)}
                                  className="mt-3 bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                                >
                                  {retrying.has(c.id) ? 'Retrying...' : 'Retry Processing'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowUpload(false); }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="font-semibold text-gray-900 text-lg">Upload Contract PDF</h2>
              <button
                onClick={() => setShowUpload(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &#10005;
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
                <strong>Note:</strong> If your PDF was sent by a health plan it may be encrypted.
                If upload fails, go to <strong>File &rarr; Print &rarr; Save as PDF</strong> and upload that copy.
              </div>

              {encryptedError && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <span className="text-amber-500 text-lg leading-none">&#9888;</span>
                    <div>
                      <p className="font-semibold text-amber-800 text-sm">PDF is encrypted</p>
                      <ol className="mt-2 space-y-1 text-sm text-amber-700 list-decimal list-inside">
                        {encryptedError.instructions.map((step, i) => <li key={i}>{step}</li>)}
                      </ol>
                    </div>
                  </div>
                </div>
              )}

              {uploadError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {uploadError}
                </div>
              )}

              <form onSubmit={handleUploadSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Facility <span className="text-red-500">*</span>
                  </label>
                  {facilities.length === 0 ? (
                    <div className="border border-dashed border-gray-300 rounded-lg px-4 py-4 text-center">
                      <p className="text-sm text-gray-500">No facilities have been set up yet.</p>
                      <Link
                        to="/facilities"
                        onClick={() => setShowUpload(false)}
                        className="mt-2 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
                      >
                        Go to Facilities to add one &rarr;
                      </Link>
                    </div>
                  ) : (
                    <select
                      required
                      value={uploadFacilityId}
                      onChange={(e) => setUploadFacilityId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                    >
                      <option value="">Select facility...</option>
                      {facilities.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Health Plan / Payer Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={payerName}
                    onChange={(e) => setPayerName(e.target.value)}
                    placeholder="e.g. Humana Medicare Advantage"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Payer Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={payerType}
                    onChange={(e) => setPayerType(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                  >
                    <option value="">Select payer type...</option>
                    {PAYER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Effective Date <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="date"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Expiration Date <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="date"
                      value={expirationDate}
                      onChange={(e) => setExpirationDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Contract PDF <span className="text-red-500">*</span>
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    required
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
                  />
                  {file && (
                    <p className="text-xs text-gray-400 mt-1">
                      {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                    </p>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={uploading || !file}
                    className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploading ? 'Uploading...' : 'Upload & Process'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowUpload(false)}
                    className="text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
