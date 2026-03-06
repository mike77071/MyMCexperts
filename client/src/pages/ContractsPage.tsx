import { useEffect, useState, useRef, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { getContracts, deleteContract, getFacilities, uploadContract } from '../services/api';
import { ContractStatus, Facility } from '../types';
import { useAuth } from '../hooks/useAuth';

interface ContractRow {
  id: string;
  payerName: string;
  payerType: string;
  status: ContractStatus;
  errorMessage: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  createdAt: string;
  facility: { id: string; name: string };
  createdBy: { id: string; name: string };
  matrix?: { extractedAt: string } | null;
}

const STATUS_BADGE: Record<ContractStatus, { label: string; className: string }> = {
  PENDING:         { label: 'Queued',      className: 'bg-gray-100 text-gray-600' },
  PROCESSING_TEXT: { label: 'Reading PDF', className: 'bg-blue-100 text-blue-700' },
  PROCESSING_OCR:  { label: 'OCR',         className: 'bg-blue-100 text-blue-700' },
  PROCESSING_AI:   { label: 'AI Extract',  className: 'bg-purple-100 text-purple-700' },
  COMPLETE:        { label: 'Complete',    className: 'bg-green-100 text-green-700' },
  ERROR:           { label: 'Error',       className: 'bg-red-100 text-red-700' },
};

const STATUS_LABELS: [ContractStatus, string][] = [
  ['PENDING', 'Queued'],
  ['PROCESSING_TEXT', 'Reading PDF'],
  ['PROCESSING_OCR', 'OCR'],
  ['PROCESSING_AI', 'AI Extract'],
  ['COMPLETE', 'Complete'],
  ['ERROR', 'Error'],
];

const PAYER_TYPES = ['Medicare Advantage', 'Medicaid MCO', 'Commercial', 'Workers Comp', 'Auto', 'Other'];

type SortCol = 'payerName' | 'status' | 'lastUpdated' | 'uploadedBy' | 'versions';
type SortDir = 'asc' | 'desc';

type EncryptedError = { message: string; instructions: string[] };

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

  const canUpload = user?.role === 'ADMIN' || user?.role === 'CASE_MANAGER';

  const reload = () =>
    getContracts()
      .then((res) => setContracts(res.data.contracts))
      .finally(() => setLoading(false));

  useEffect(() => { reload(); }, []);

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
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sort.col === 'payerName') {
      cmp = a.payerName.localeCompare(b.payerName);
    } else if (sort.col === 'status') {
      cmp = a.status.localeCompare(b.status);
    } else if (sort.col === 'lastUpdated') {
      cmp = new Date(getLastUpdated(a)).getTime() - new Date(getLastUpdated(b)).getTime();
    } else if (sort.col === 'uploadedBy') {
      cmp = (a.createdBy?.name ?? '').localeCompare(b.createdBy?.name ?? '');
    } else if (sort.col === 'versions') {
      const va = versionMap.get(`${a.payerName.toLowerCase()}:${a.facility.id}`) ?? 1;
      const vb = versionMap.get(`${b.payerName.toLowerCase()}:${b.facility.id}`) ?? 1;
      cmp = va - vb;
    }
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  const SortIndicator = ({ col }: { col: SortCol }) =>
    sort.col !== col
      ? <span className="ml-1 text-gray-300">↕</span>
      : <span className="ml-1 text-brand-600">{sort.dir === 'asc' ? '↑' : '↓'}</span>;

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
            {contracts.length} contract{contracts.length !== 1 ? 's' : ''} across all facilities
          </p>
        </div>
        {canUpload && (
          <button
            onClick={openUpload}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Upload Contract
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-5">
        <input
          type="text"
          placeholder="Search by payer…"
          value={searchPayor}
          onChange={(e) => setSearchPayor(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-60"
        />
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
        {(searchPayor || filterStatus) && (
          <button
            onClick={() => { setSearchPayor(''); setFilterStatus(''); }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear filters
          </button>
        )}
      </div>

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
                  <Th col="status">Status</Th>
                  <Th col="lastUpdated">Last Updated</Th>
                  <Th col="uploadedBy">Uploaded By</Th>
                  <Th col="versions">Versions</Th>
                  <th className="px-5 py-3 font-medium text-gray-600 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((c) => {
                  const badge = STATUS_BADGE[c.status];
                  const versionKey = `${c.payerName.toLowerCase()}:${c.facility.id}`;
                  const versions = versionMap.get(versionKey) ?? 1;
                  return (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="font-medium text-gray-900">{c.payerName}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {c.payerType} &middot;{' '}
                          <Link to={`/facilities/${c.facility.id}`} className="hover:text-brand-600">
                            {c.facility.name}
                          </Link>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.className}`}>
                          {badge.label}
                        </span>
                        {c.status === 'ERROR' && c.errorMessage && (
                          <p className="text-xs text-red-500 mt-1 max-w-[180px] truncate" title={c.errorMessage}>
                            {c.errorMessage}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                        {new Date(getLastUpdated(c)).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3 text-gray-500">{c.createdBy?.name ?? '—'}</td>
                      <td className="px-5 py-3 text-gray-500 text-center">{versions}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-3">
                          {c.status === 'COMPLETE' && (
                            <Link
                              to={`/contracts/${c.id}/matrix`}
                              className="text-xs text-brand-600 hover:text-brand-700 font-medium whitespace-nowrap"
                            >
                              View Matrix
                            </Link>
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
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
                <strong>Note:</strong> If your PDF was sent by a health plan it may be encrypted.
                If upload fails, go to <strong>File → Print → Save as PDF</strong> and upload that copy.
              </div>

              {encryptedError && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <span className="text-amber-500 text-lg leading-none">⚠</span>
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
                        Go to Facilities to add one →
                      </Link>
                    </div>
                  ) : (
                    <select
                      required
                      value={uploadFacilityId}
                      onChange={(e) => setUploadFacilityId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                    >
                      <option value="">Select facility…</option>
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
                    <option value="">Select payer type…</option>
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
                    {uploading ? 'Uploading…' : 'Upload & Process'}
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
