import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDashboard } from '../services/api';
import { ContractStatus } from '../types';
import { useAuth } from '../hooks/useAuth';

interface DashboardStats {
  totalContracts: number;
  processingCount: number;
  errorCount: number;
  facilitiesCount: number;
  expiringRed: number;
  expiringAmber: number;
  expiringYellow: number;
}

interface ExpiringContract {
  id: string;
  payerName: string;
  payerType: string;
  expirationDate: string;
  daysUntilExpiry: number;
  facility: { id: string; name: string };
}

interface RecentContract {
  id: string;
  payerName: string;
  payerType: string;
  status: ContractStatus;
  createdAt: string;
  facility: { id: string; name: string };
  createdBy: { name: string };
}

interface DashboardData {
  stats: DashboardStats;
  expiringContracts: ExpiringContract[];
  recentContracts: RecentContract[];
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ExpiryBadge({ days }: { days: number }) {
  if (days <= 30) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        {days}d
      </span>
    );
  }
  if (days <= 60) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        {days}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded-full">
      <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
      {days}d
    </span>
  );
}

function StatusBadge({ status }: { status: ContractStatus }) {
  const map: Record<ContractStatus, { label: string; className: string }> = {
    COMPLETE: { label: 'Complete', className: 'text-green-700 bg-green-50' },
    ERROR: { label: 'Error', className: 'text-red-700 bg-red-50' },
    PENDING: { label: 'Pending', className: 'text-gray-600 bg-gray-100' },
    PROCESSING_TEXT: { label: 'Processing', className: 'text-blue-700 bg-blue-50' },
    PROCESSING_OCR: { label: 'OCR', className: 'text-blue-700 bg-blue-50' },
    PROCESSING_AI: { label: 'AI Extract', className: 'text-purple-700 bg-purple-50' },
  };
  const { label, className } = map[status] ?? { label: status, className: 'text-gray-600 bg-gray-100' };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${className}`}>{label}</span>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: 'red' | 'amber' | 'blue' | 'gray';
}) {
  const border = {
    red: 'border-t-2 border-t-red-400',
    amber: 'border-t-2 border-t-amber-400',
    blue: 'border-t-2 border-t-brand-400',
    gray: '',
  }[accent ?? 'gray'];

  const valueColor = {
    red: 'text-red-600',
    amber: 'text-amber-600',
    blue: 'text-brand-700',
    gray: 'text-gray-900',
  }[accent ?? 'gray'];

  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-5 shadow-sm ${border}`}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboard()
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-8 w-8 rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!data) return null;

  const { stats, expiringContracts, recentContracts } = data;
  const totalExpiring = stats.expiringRed + stats.expiringAmber + stats.expiringYellow;
  const expiringAccent = stats.expiringRed > 0 ? 'red' : stats.expiringAmber > 0 ? 'amber' : 'gray';

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {getGreeting()}, {user?.name?.split(' ')[0]}
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total Contracts"
          value={stats.totalContracts}
          sub={`across ${stats.facilitiesCount} ${stats.facilitiesCount === 1 ? 'facility' : 'facilities'}`}
          accent="blue"
        />
        <StatCard
          label="Expiring (90 days)"
          value={totalExpiring}
          sub={
            stats.expiringRed > 0
              ? `${stats.expiringRed} critical (≤30 days)`
              : totalExpiring === 0
              ? 'None upcoming'
              : `${stats.expiringAmber} within 60 days`
          }
          accent={totalExpiring === 0 ? 'gray' : expiringAccent}
        />
        <StatCard
          label="Processing"
          value={stats.processingCount}
          sub={stats.processingCount === 0 ? 'Queue clear' : 'contracts in flight'}
          accent={stats.processingCount > 0 ? 'blue' : 'gray'}
        />
        <StatCard
          label="Errors"
          value={stats.errorCount}
          sub={stats.errorCount === 0 ? 'All clear' : 'need attention'}
          accent={stats.errorCount > 0 ? 'red' : 'gray'}
        />
      </div>

      {/* Alert banner for critical expirations */}
      {stats.expiringRed > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 mb-6 flex items-start gap-3">
          <div className="h-5 w-5 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-red-600 text-xs font-bold">!</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-red-800">
              {stats.expiringRed} contract{stats.expiringRed !== 1 ? 's' : ''} expiring within 30 days
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              Review and start renegotiation to avoid coverage gaps.
            </p>
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Expiring contracts — wider column */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Expiring Contracts</h2>
                <p className="text-xs text-gray-400 mt-0.5">Next 90 days, sorted by urgency</p>
              </div>
              <Link
                to="/contracts"
                className="text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                View all →
              </Link>
            </div>

            {expiringContracts.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-2xl mb-2">✓</p>
                <p className="text-sm font-medium text-gray-700">No contracts expiring in the next 90 days</p>
                <p className="text-xs text-gray-400 mt-1">You're all caught up.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {expiringContracts.map((c) => (
                  <div key={c.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                    <ExpiryBadge days={c.daysUntilExpiry} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.payerName}</p>
                      <p className="text-xs text-gray-500 truncate">{c.facility.name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-gray-500">{formatDate(c.expirationDate)}</p>
                      <p className="text-xs text-gray-400">{c.payerType}</p>
                    </div>
                    <Link
                      to={`/contracts/${c.id}/matrix`}
                      className="text-xs text-brand-600 hover:text-brand-700 border border-brand-200 px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0"
                    >
                      View
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent uploads — narrower column */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Recent Uploads</h2>
                <p className="text-xs text-gray-400 mt-0.5">Last 8 contracts</p>
              </div>
              <Link
                to="/contracts"
                className="text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                View all →
              </Link>
            </div>

            {recentContracts.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-gray-400">No contracts uploaded yet.</p>
                <Link
                  to="/contracts"
                  className="mt-2 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  Upload your first →
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {recentContracts.map((c) => (
                  <Link
                    key={c.id}
                    to={`/contracts/${c.id}/matrix`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate group-hover:text-brand-700">
                        {c.payerName}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{c.facility.name}</p>
                    </div>
                    <StatusBadge status={c.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="mt-4 bg-brand-50 border border-brand-200 rounded-xl p-5">
            <p className="text-sm font-semibold text-brand-800 mb-3">Quick Actions</p>
            <div className="space-y-2">
              <Link
                to="/contracts"
                className="flex items-center gap-2 text-sm text-brand-700 hover:text-brand-900 font-medium"
              >
                <span className="text-brand-400">+</span> Upload Contract
              </Link>
              <Link
                to="/facilities"
                className="flex items-center gap-2 text-sm text-brand-700 hover:text-brand-900 font-medium"
              >
                <span className="text-brand-400">+</span> Add Facility
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
