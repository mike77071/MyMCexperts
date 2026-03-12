import { useEffect, useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getFacility, deleteContract } from '../services/api';
import { Facility, Contract, ContractStatus } from '../types';
import { useAuth } from '../hooks/useAuth';

const STATUS_LABELS: Record<ContractStatus, string> = {
  PENDING: 'Queued',
  PROCESSING_TEXT: 'Reading PDF',
  PROCESSING_OCR: 'Running OCR',
  PROCESSING_AI: 'AI Extract',
  COMPLETE: 'Complete',
  ERROR: 'Error',
};

const STATUS_COLORS: Record<ContractStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  PROCESSING_TEXT: 'bg-blue-100 text-blue-700',
  PROCESSING_OCR: 'bg-purple-100 text-purple-700',
  PROCESSING_AI: 'bg-yellow-100 text-yellow-700',
  COMPLETE: 'bg-green-100 text-green-700',
  ERROR: 'bg-red-100 text-red-700',
};

type SortKey = 'payerName' | 'payerType' | 'status' | 'effectiveDate' | 'expirationDate' | 'createdAt';
type SortDir = 'asc' | 'desc';

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-gray-300 ml-1">↕</span>;
  return <span className="text-brand-600 ml-1">{dir === 'asc' ? '↑' : '↓'}</span>;
}

export function FacilityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [facility, setFacility] = useState<(Facility & { contracts: Contract[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'ALL'>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('expirationDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const { user } = useAuth();
  const navigate = useNavigate();

  const load = () => {
    if (!id) return;
    getFacility(id)
      .then((res) => setFacility(res.data.facility))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const handleDelete = async (contractId: string) => {
    if (!confirm('Delete this contract? This cannot be undone.')) return;
    await deleteContract(contractId);
    load();
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const contracts = useMemo(() => {
    if (!facility) return [];
    let rows = facility.contracts;

    // Search filter
    const q = search.toLowerCase();
    if (q) {
      rows = rows.filter(
        (c) =>
          c.payerName.toLowerCase().includes(q) ||
          c.payerType.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (statusFilter !== 'ALL') {
      rows = rows.filter((c) => c.status === statusFilter);
    }

    // Sort
    rows = [...rows].sort((a, b) => {
      let av: string | number = '';
      let bv: string | number = '';

      if (sortKey === 'payerName') { av = a.payerName; bv = b.payerName; }
      else if (sortKey === 'payerType') { av = a.payerType; bv = b.payerType; }
      else if (sortKey === 'status') { av = a.status; bv = b.status; }
      else if (sortKey === 'effectiveDate') {
        av = a.effectiveDate ? new Date(a.effectiveDate).getTime() : 0;
        bv = b.effectiveDate ? new Date(b.effectiveDate).getTime() : 0;
      } else if (sortKey === 'expirationDate') {
        av = a.expirationDate ? new Date(a.expirationDate).getTime() : Infinity;
        bv = b.expirationDate ? new Date(b.expirationDate).getTime() : Infinity;
      } else if (sortKey === 'createdAt') {
        av = new Date(a.createdAt).getTime();
        bv = new Date(b.createdAt).getTime();
      }

      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return rows;
  }, [facility, search, statusFilter, sortKey, sortDir]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-8 w-8 rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!facility) {
    return <div className="text-center py-16 text-gray-400">Facility not found.</div>;
  }

  const Th = ({ label, sortable, col }: { label: string; sortable?: SortKey; col?: string }) => (
    <th
      className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide ${col ?? ''} ${sortable ? 'cursor-pointer select-none hover:text-gray-700' : ''}`}
      onClick={sortable ? () => toggleSort(sortable) : undefined}
    >
      {label}
      {sortable && <SortIcon active={sortKey === sortable} dir={sortDir} />}
    </th>
  );

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 mb-4">
        <Link to="/facilities" className="hover:text-brand-600">Facilities</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">{facility.name}</span>
      </nav>

      {/* Facility header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{facility.name}</h1>
            <p className="text-gray-500 mt-1">
              {facility.address}, {facility.city}, {facility.state} {facility.zip}
            </p>
            <div className="flex gap-4 mt-2 text-sm text-gray-400">
              {facility.npi && <span>NPI: {facility.npi}</span>}
              {facility.phone && <span>Phone: {facility.phone}</span>}
            </div>
          </div>
          <Link
            to={`/facilities/${id}/contracts/upload`}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Upload Contract
          </Link>
        </div>
      </div>

      {/* Contracts grid */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        {/* Toolbar */}
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">
              Contracts{' '}
              <span className="text-gray-400 font-normal text-sm">
                ({contracts.length}{contracts.length !== facility.contracts.length ? ` of ${facility.contracts.length}` : ''})
              </span>
            </h2>
          </div>
          <input
            type="search"
            placeholder="Search payer name or type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-56"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ContractStatus | 'ALL')}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="ALL">All Statuses</option>
            {(Object.keys(STATUS_LABELS) as ContractStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>

        {contracts.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            {facility.contracts.length === 0 ? (
              <>
                <p className="mb-2">No contracts uploaded yet.</p>
                <Link
                  to={`/facilities/${id}/contracts/upload`}
                  className="text-brand-600 hover:text-brand-700 text-sm"
                >
                  Upload your first contract →
                </Link>
              </>
            ) : (
              <p>No contracts match your filters.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <Th label="Payer Name" sortable="payerName" />
                  <Th label="Type" sortable="payerType" />
                  <Th label="Status" sortable="status" />
                  <Th label="Effective" sortable="effectiveDate" />
                  <Th label="Expires" sortable="expirationDate" />
                  <Th label="Uploaded" sortable="createdAt" />
                  <Th label="Uploaded By" />
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {contracts.map((c) => {
                  const isExpiringSoon =
                    c.status === 'COMPLETE' &&
                    c.expirationDate &&
                    (() => {
                      const days = Math.ceil(
                        (new Date(c.expirationDate!).getTime() - Date.now()) / 86400000
                      );
                      return days >= 0 && days <= 90 ? days : null;
                    })();

                  return (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate">
                        {c.payerName}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{c.payerType}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[c.status]}`}>
                          {STATUS_LABELS[c.status]}
                        </span>
                        {c.status === 'ERROR' && c.errorMessage && (
                          <p className="text-xs text-red-500 mt-0.5 max-w-[160px] truncate" title={c.errorMessage}>
                            {c.errorMessage}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(c.effectiveDate)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.expirationDate ? (
                          <span className={
                            typeof isExpiringSoon === 'number'
                              ? isExpiringSoon <= 30
                                ? 'text-red-600 font-medium'
                                : isExpiringSoon <= 60
                                ? 'text-amber-600 font-medium'
                                : 'text-yellow-600 font-medium'
                              : 'text-gray-500'
                          }>
                            {fmtDate(c.expirationDate)}
                            {typeof isExpiringSoon === 'number' && (
                              <span className="ml-1 text-xs">({isExpiringSoon}d)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[120px] truncate">{c.createdBy}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {c.status === 'COMPLETE' && (
                            <button
                              onClick={() => navigate(`/contracts/${c.id}/matrix`)}
                              className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-2.5 py-1 rounded transition-colors"
                            >
                              View Matrix
                            </button>
                          )}
                          {user?.role === 'ADMIN' && (
                            <button
                              onClick={() => handleDelete(c.id)}
                              className="text-xs text-red-500 hover:text-red-700 transition-colors"
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
        )}
      </div>
    </div>
  );
}
