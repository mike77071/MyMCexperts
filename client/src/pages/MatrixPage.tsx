import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getContractMatrix, getExportUrl } from '../services/api';
import { Contract, ContractMatrix, ContractStatus } from '../types';
import { usePolling } from '../hooks/usePolling';

const STATUS_MESSAGES: Record<ContractStatus, string> = {
  PENDING: 'Queued for processing…',
  PROCESSING_TEXT: 'Reading PDF text…',
  PROCESSING_OCR: 'Running OCR — this may take a minute for scanned documents…',
  PROCESSING_AI: 'Extracting contract terms with AI…',
  COMPLETE: '',
  ERROR: '',
};

function NotFound() {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-yellow-50 border border-yellow-200 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
      Not stated in contract
    </span>
  );
}

function Value({ v }: { v: string | number | null | undefined }) {
  if (v === null || v === undefined || v === '') return <NotFound />;
  return <span>{String(v)}</span>;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="bg-brand-900 px-5 py-3">
        <h2 className="text-white font-semibold text-sm uppercase tracking-wide">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-gray-50 last:border-0">
      <dt className="text-sm font-medium text-gray-600 w-48 shrink-0">{label}</dt>
      <dd className="text-sm text-gray-900">
        <Value v={value} />
      </dd>
    </div>
  );
}

function ListValue({ items }: { items: string[] }) {
  if (items.length === 0) return <NotFound />;
  return (
    <ul className="list-disc list-inside space-y-1 text-sm text-gray-900">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const colors = {
    high: 'bg-green-100 text-green-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors[level]}`}>
      {level.toUpperCase()} CONFIDENCE
    </span>
  );
}

export function MatrixPage() {
  const { contractId } = useParams<{ contractId: string }>();
  const [contract, setContract] = useState<Contract | null>(null);
  const [matrix, setMatrix] = useState<ContractMatrix | null>(null);
  const [error, setError] = useState('');

  const isComplete = contract?.status === 'COMPLETE';
  const isError = contract?.status === 'ERROR';
  const isDone = isComplete || isError;

  const poll = useCallback(async () => {
    if (!contractId) return;
    try {
      const res = await getContractMatrix(contractId);
      setContract(res.data.contract);
      if (res.data.matrix) setMatrix(res.data.matrix);
    } catch {
      setError('Failed to load contract data.');
    }
  }, [contractId]);

  usePolling(poll, 3000, isDone);

  if (error) {
    return (
      <div className="text-center py-16 text-red-600">
        <p>{error}</p>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-8 w-8 rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!isComplete) {
    return (
      <div className="max-w-lg mx-auto py-20 text-center">
        {isError ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-8">
            <p className="font-semibold text-red-700 text-lg">Processing failed</p>
            <p className="text-red-600 text-sm mt-2">{contract.errorMessage}</p>
            <Link
              to={`/facilities/${contract.facility?.id}`}
              className="text-brand-600 hover:text-brand-700 text-sm mt-4 inline-block"
            >
              ← Back to facility
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-10">
            <div className="animate-spin h-10 w-10 rounded-full border-4 border-brand-600 border-t-transparent mx-auto mb-5" />
            <p className="text-gray-700 font-medium">
              {STATUS_MESSAGES[contract.status] || 'Processing…'}
            </p>
            <p className="text-gray-400 text-sm mt-2">This page updates automatically.</p>
          </div>
        )}
      </div>
    );
  }

  if (!matrix) return null;

  const { payerInfo, reimbursementRates, coveredServices, authorizationRequirements, timelyFiling, extractionMetadata } = matrix;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <nav className="text-sm text-gray-500 mb-2">
            <Link to="/facilities" className="hover:text-brand-600">Facilities</Link>
            <span className="mx-2">/</span>
            <Link to={`/facilities/${contract.facility?.id}`} className="hover:text-brand-600">
              {contract.facility?.name}
            </Link>
            <span className="mx-2">/</span>
            <span className="text-gray-900">Contract Matrix</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">{contract.payerName}</h1>
          <p className="text-gray-500 text-sm mt-1">{contract.payerType}</p>
        </div>
        <a
          href={getExportUrl(contract.id)}
          download
          className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Export to Excel
        </a>
      </div>

      {/* Extraction warnings */}
      {(extractionMetadata.missingFields.length > 0 || extractionMetadata.warnings.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-amber-500">⚠</span>
            <ConfidenceBadge level={extractionMetadata.confidence} />
            <span className="text-sm text-amber-700 font-medium">Extraction notes</span>
          </div>
          {extractionMetadata.missingFields.length > 0 && (
            <p className="text-sm text-amber-700">
              <strong>Not found in contract:</strong>{' '}
              {extractionMetadata.missingFields.join(', ')}
            </p>
          )}
          {extractionMetadata.warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-600 mt-1">• {w}</p>
          ))}
        </div>
      )}

      <div className="space-y-5">
        {/* Payer Info */}
        <SectionCard title="Payer Information">
          <dl>
            <Row label="Payer Name" value={payerInfo.payerName} />
            <Row label="Payer Type" value={payerInfo.payerType} />
            <Row label="Effective Date" value={payerInfo.contractEffectiveDate} />
            <Row label="Expiration Date" value={payerInfo.contractExpirationDate} />
            <Row label="Contact Name" value={payerInfo.contactName} />
            <Row label="Contact Phone" value={payerInfo.contactPhone} />
            <Row label="Contact Email" value={payerInfo.contactEmail} />
            <Row label="Provider Relations Phone" value={payerInfo.providerRelationsPhone} />
          </dl>
        </SectionCard>

        {/* Reimbursement Rates */}
        <SectionCard title="Reimbursement Rates">
          {reimbursementRates.perDiemRates.length > 0 ? (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Per Diem Rates</h3>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-3 py-2 text-gray-600 font-medium border border-gray-200">
                      Level of Care
                    </th>
                    <th className="text-left px-3 py-2 text-gray-600 font-medium border border-gray-200">
                      Rate / Day
                    </th>
                    <th className="text-left px-3 py-2 text-gray-600 font-medium border border-gray-200">
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reimbursementRates.perDiemRates.map((r, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-3 py-2 border border-gray-200">{r.levelOfCare}</td>
                      <td className="px-3 py-2 border border-gray-200">
                        {r.ratePerDay !== null ? `$${r.ratePerDay.toFixed(2)}` : <NotFound />}
                      </td>
                      <td className="px-3 py-2 border border-gray-200">
                        <Value v={r.notes} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Row label="Per Diem Rates" value={null} />
          )}

          <Row label="PDPM / RUG Notes" value={reimbursementRates.pdpmOrRugNotes} />

          {reimbursementRates.procedureCodes.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Procedure Codes</h3>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    {['Code', 'Description', 'Rate', 'Unit'].map((h) => (
                      <th
                        key={h}
                        className="text-left px-3 py-2 text-gray-600 font-medium border border-gray-200"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reimbursementRates.procedureCodes.map((pc, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-3 py-2 border border-gray-200 font-mono text-xs">{pc.code}</td>
                      <td className="px-3 py-2 border border-gray-200">{pc.description}</td>
                      <td className="px-3 py-2 border border-gray-200">
                        {pc.rate !== null ? `$${pc.rate}` : <NotFound />}
                      </td>
                      <td className="px-3 py-2 border border-gray-200">
                        <Value v={pc.unit} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Row label="Other Rates" value={reimbursementRates.otherRates} />
        </SectionCard>

        {/* Covered Services */}
        <SectionCard title="Covered Services & Exclusions">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Included Services</h3>
              <ListValue items={coveredServices.included} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Excluded Services (Carve-outs)</h3>
              <ListValue items={coveredServices.excluded} />
            </div>
          </div>
          {coveredServices.notes && (
            <p className="text-sm text-gray-600 mt-4 pt-4 border-t border-gray-100">
              {coveredServices.notes}
            </p>
          )}
        </SectionCard>

        {/* Authorization Requirements */}
        <SectionCard title="Authorization Requirements">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Services Requiring Prior Auth</h3>
            <ListValue items={authorizationRequirements.requiresPriorAuth} />
          </div>
          <dl>
            <Row label="Initial Auth Days" value={authorizationRequirements.initialAuthDays} />
            <Row label="Concurrent Review" value={authorizationRequirements.concurrentReviewFrequency} />
            <Row label="Auth Contact Phone" value={authorizationRequirements.authContactPhone} />
            <Row label="Notes" value={authorizationRequirements.notes} />
          </dl>
        </SectionCard>

        {/* Timely Filing */}
        <SectionCard title="Timely Filing Limits">
          <dl>
            <Row
              label="Initial Claim"
              value={
                timelyFiling.initialClaimDays !== null
                  ? `${timelyFiling.initialClaimDays} days from date of service`
                  : null
              }
            />
            <Row
              label="Corrected Claim"
              value={
                timelyFiling.correctedClaimDays !== null
                  ? `${timelyFiling.correctedClaimDays} days`
                  : null
              }
            />
            <Row
              label="Appeal Deadline"
              value={
                timelyFiling.appealDays !== null ? `${timelyFiling.appealDays} days` : null
              }
            />
            <Row label="Notes" value={timelyFiling.notes} />
          </dl>
        </SectionCard>
      </div>
    </div>
  );
}
