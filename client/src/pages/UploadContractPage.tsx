import { useState, FormEvent, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { uploadContract } from '../services/api';

const PAYER_TYPES = [
  'Medicare Advantage',
  'Medicaid MCO',
  'Commercial',
  'Workers Comp',
  'Auto',
  'Other',
];

type EncryptedError = {
  message: string;
  instructions: string[];
};

export function UploadContractPage() {
  const { facilityId } = useParams<{ facilityId: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [payerName, setPayerName] = useState('');
  const [payerType, setPayerType] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [encryptedError, setEncryptedError] = useState<EncryptedError | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !facilityId) return;

    setError('');
    setEncryptedError(null);
    setUploading(true);

    const formData = new FormData();
    formData.append('pdf', file);
    formData.append('payerName', payerName);
    formData.append('payerType', payerType);
    if (effectiveDate) formData.append('effectiveDate', effectiveDate);
    if (expirationDate) formData.append('expirationDate', expirationDate);

    try {
      const res = await uploadContract(facilityId, formData);
      navigate(`/contracts/${res.data.contractId}/matrix`);
    } catch (err: unknown) {
      const errData = (err as { response?: { data?: { error?: string; message?: string; instructions?: string[] } } })
        ?.response?.data;

      if (errData?.error === 'PDF_ENCRYPTED') {
        setEncryptedError({
          message: errData.message ?? 'This PDF is encrypted.',
          instructions: errData.instructions ?? [],
        });
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        setError(errData?.message ?? 'Upload failed. Please try again.');
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <nav className="text-sm text-gray-500 mb-4">
        <Link to="/facilities" className="hover:text-brand-600">Facilities</Link>
        <span className="mx-2">/</span>
        <Link to={`/facilities/${facilityId}`} className="hover:text-brand-600">Facility</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">Upload Contract</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Upload Contract PDF</h1>

      {/* Passive encryption notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700 mb-6">
        <strong>Note:</strong> If your PDF was sent by a health plan, it may be encrypted or
        copy-protected. If upload fails, open the file, go to{' '}
        <strong>File → Print → Save as PDF</strong>, and upload that new copy instead.
      </div>

      {/* Encrypted PDF error */}
      {encryptedError && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-5 mb-6">
          <div className="flex items-start gap-3">
            <span className="text-amber-500 text-xl leading-none">⚠</span>
            <div>
              <p className="font-semibold text-amber-800">This PDF is encrypted by the health plan</p>
              <ol className="mt-3 space-y-1.5 text-sm text-amber-700 list-decimal list-inside">
                {encryptedError.instructions.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              <p className="text-sm text-amber-600 mt-3">
                Choose a new file below and try again.
              </p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* PDF file */}
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

        {/* Payer name */}
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

        {/* Payer type */}
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
            {PAYER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* Optional dates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Effective Date <span className="text-gray-400">(optional)</span>
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
              Expiration Date <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={uploading || !file}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? 'Uploading…' : 'Upload & Process'}
          </button>
          <Link
            to={`/facilities/${facilityId}`}
            className="text-sm text-gray-600 hover:text-gray-800 self-center"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
