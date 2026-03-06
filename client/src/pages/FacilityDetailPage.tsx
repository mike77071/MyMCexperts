import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getFacility, deleteContract } from '../services/api';
import { Facility, Contract, ContractStatus } from '../types';
import { useAuth } from '../hooks/useAuth';

const STATUS_LABELS: Record<ContractStatus, string> = {
  PENDING: 'Queued…',
  PROCESSING_TEXT: 'Reading PDF…',
  PROCESSING_OCR: 'Running OCR…',
  PROCESSING_AI: 'Extracting with AI…',
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

export function FacilityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [facility, setFacility] = useState<(Facility & { contracts: Contract[] }) | null>(null);
  const [loading, setLoading] = useState(true);
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

      {/* Contracts list */}
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Contracts ({facility.contracts.length})
      </h2>

      {facility.contracts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          <p>No contracts uploaded yet.</p>
          <Link
            to={`/facilities/${id}/contracts/upload`}
            className="text-brand-600 hover:text-brand-700 text-sm mt-2 inline-block"
          >
            Upload your first contract →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {facility.contracts.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-gray-900 truncate">{c.payerName}</h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[c.status]}`}
                  >
                    {STATUS_LABELS[c.status]}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-0.5">
                  {c.payerType}
                  {c.effectiveDate &&
                    ` · Effective ${new Date(c.effectiveDate).toLocaleDateString()}`}
                  {c.expirationDate &&
                    ` – ${new Date(c.expirationDate).toLocaleDateString()}`}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Uploaded by {c.createdBy} on {new Date(c.createdAt).toLocaleDateString()}
                </p>
                {c.status === 'ERROR' && c.errorMessage && (
                  <p className="text-xs text-red-600 mt-1">{c.errorMessage}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {c.status === 'COMPLETE' && (
                  <button
                    onClick={() => navigate(`/contracts/${c.id}/matrix`)}
                    className="text-sm bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    View Matrix
                  </button>
                )}
                {user?.role === 'ADMIN' && (
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="text-sm text-red-500 hover:text-red-700 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
