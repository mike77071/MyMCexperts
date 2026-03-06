import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFacilities, createFacility, updateFacility, deleteFacility } from '../services/api';
import { Facility } from '../types';
import { useAuth } from '../hooks/useAuth';

const EMPTY_FORM = { name: '', address: '', city: '', state: '', zip: '', npi: '', phone: '' };

const US_STATES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
  ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],
  ['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],
  ['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
  ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],
  ['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],
  ['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],
  ['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
  ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],
  ['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
  ['DC','District of Columbia'],
] as const;

const FIELDS: {
  label: string;
  key: keyof typeof EMPTY_FORM;
  required?: boolean;
  colSpan?: number;
  maxLength?: number;
  placeholder?: string;
  hint?: string;
  type?: 'text' | 'state-select';
}[] = [
  { label: 'Facility Name', key: 'name', required: true, colSpan: 2, placeholder: 'e.g. Sunrise Skilled Nursing' },
  { label: 'Street Address', key: 'address', required: true, colSpan: 2, placeholder: '123 Main St' },
  { label: 'City', key: 'city', required: true, placeholder: 'Springfield' },
  { label: 'State', key: 'state', required: true, type: 'state-select' },
  { label: 'ZIP Code', key: 'zip', required: true, placeholder: '62701', hint: '5-digit or ZIP+4' },
  { label: 'NPI', key: 'npi', placeholder: '1234567890', hint: 'Optional — 10 digits' },
  { label: 'Phone', key: 'phone', placeholder: '(555) 555-0100', hint: 'Optional' },
];

type FieldErrors = Partial<Record<keyof typeof EMPTY_FORM, string>>;

function parseFieldErrors(err: unknown): FieldErrors {
  const data = (err as { response?: { data?: { details?: { fieldErrors?: Record<string, string[]> } } } })
    ?.response?.data?.details?.fieldErrors;
  if (!data) return {};
  const out: FieldErrors = {};
  for (const [key, messages] of Object.entries(data)) {
    if (messages[0]) out[key as keyof typeof EMPTY_FORM] = messages[0];
  }
  return out;
}

function parseGeneralError(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
  if (data?.message) return data.message;
  if (data?.error) return data.error;
  return 'An unexpected error occurred. Please try again.';
}

export function FacilitiesPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingFacility, setEditingFacility] = useState<Facility | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState('');
  const { user } = useAuth();
  const navigate = useNavigate();

  const reload = () =>
    getFacilities().then((res) => setFacilities(res.data.facilities)).finally(() => setLoading(false));

  useEffect(() => { reload(); }, []);

  const openCreate = () => {
    setEditingFacility(null);
    setForm({ ...EMPTY_FORM });
    setFieldErrors({});
    setGeneralError('');
    setShowForm(true);
  };

  const openEdit = (f: Facility, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingFacility(f);
    setForm({ name: f.name, address: f.address, city: f.city, state: f.state, zip: f.zip, npi: f.npi ?? '', phone: f.phone ?? '' });
    setFieldErrors({});
    setGeneralError('');
    setShowForm(true);
  };

  const handleChange = (key: keyof typeof EMPTY_FORM, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((e) => ({ ...e, [key]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setGeneralError('');
    setSaving(true);
    try {
      if (editingFacility) {
        await updateFacility(editingFacility.id, form);
      } else {
        await createFacility(form);
      }
      await reload();
      setShowForm(false);
    } catch (err) {
      const fe = parseFieldErrors(err);
      if (Object.keys(fe).length > 0) {
        setFieldErrors(fe);
      } else {
        setGeneralError(parseGeneralError(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (f: Facility, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${f.name}"? This will also delete all its contracts and cannot be undone.`)) return;
    await deleteFacility(f.id);
    reload();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-8 w-8 rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Facility Management</h1>
          <p className="text-gray-500 text-sm mt-1">
            {facilities.length} {facilities.length === 1 ? 'facility' : 'facilities'}
          </p>
        </div>
        {user?.role === 'ADMIN' && (
          <button
            onClick={openCreate}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Add Facility
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-4">
            {editingFacility ? `Edit — ${editingFacility.name}` : 'Add New Facility'}
          </h2>

          {generalError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
              {generalError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FIELDS.map(({ label, key, required, colSpan, maxLength, placeholder, hint, type }) => (
              <div key={key} className={colSpan === 2 ? 'sm:col-span-2' : ''}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {label}
                  {required
                    ? <span className="text-red-500 ml-0.5">*</span>
                    : <span className="text-gray-400 font-normal text-xs ml-1">(optional)</span>
                  }
                </label>
                {type === 'state-select' ? (
                  <select
                    required
                    value={form[key]}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white transition-colors ${
                      fieldErrors[key] ? 'border-red-400 bg-red-50 focus:ring-red-400' : 'border-gray-300'
                    }`}
                  >
                    <option value="">Select state…</option>
                    {US_STATES.map(([abbr, name]) => (
                      <option key={abbr} value={abbr}>{name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required={required}
                    maxLength={maxLength}
                    value={form[key]}
                    placeholder={placeholder}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors ${
                      fieldErrors[key]
                        ? 'border-red-400 bg-red-50 focus:ring-red-400'
                        : 'border-gray-300'
                    }`}
                  />
                )}
                {fieldErrors[key] ? (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors[key]}</p>
                ) : hint ? (
                  <p className="text-xs text-gray-400 mt-1">{hint}</p>
                ) : null}
              </div>
            ))}
            <div className="sm:col-span-2 flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : editingFacility ? 'Save Changes' : 'Save Facility'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {facilities.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No facilities yet.</p>
          {user?.role === 'ADMIN' && (
            <p className="text-sm mt-1">Click "Add Facility" to get started.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {facilities.map((f) => (
            <div
              key={f.id}
              onClick={() => navigate(`/facilities/${f.id}`)}
              className="bg-white rounded-xl border border-gray-200 p-5 cursor-pointer hover:border-brand-400 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-gray-900 group-hover:text-brand-700">{f.name}</h3>
                {user?.role === 'ADMIN' && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={(e) => openEdit(f, e)}
                      className="text-xs text-gray-400 hover:text-brand-600 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => handleDelete(f, e)}
                      className="text-xs text-gray-400 hover:text-red-600 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {f.city}, {f.state} {f.zip}
              </p>
              {f.npi && <p className="text-xs text-gray-400 mt-1">NPI: {f.npi}</p>}
              <p className="text-xs text-brand-600 mt-3 font-medium">
                {f._count?.contracts ?? 0} contract{f._count?.contracts !== 1 ? 's' : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
