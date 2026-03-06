import { useEffect, useState } from 'react';
import {
  getUsers,
  getFacilities,
  createUser,
  updateUser,
  deleteUser,
  assignFacilities,
} from '../services/api';
import { User, Facility, Role } from '../types';
import { useAuth } from '../hooks/useAuth';

const ROLES: Role[] = ['ADMIN', 'CASE_MANAGER', 'BILLER', 'VIEWER'];
const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  CASE_MANAGER: 'Case Manager',
  BILLER: 'Biller / Business Office',
  VIEWER: 'Read-only Viewer',
};
const ROLE_COLORS: Record<Role, string> = {
  ADMIN: 'bg-purple-100 text-purple-700',
  CASE_MANAGER: 'bg-blue-100 text-blue-700',
  BILLER: 'bg-amber-100 text-amber-700',
  VIEWER: 'bg-gray-100 text-gray-600',
};

interface UserWithFacilities extends User {
  facilities?: Array<{ facilityId: string; facility: { name: string } }>;
}

function formatLastLogin(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function AdminPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserWithFacilities[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);

  // Create user form
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', name: '', role: 'VIEWER' as Role });
  const [createError, setCreateError] = useState('');
  const [createSaving, setCreateSaving] = useState(false);

  // Edit user modal
  const [editingUser, setEditingUser] = useState<UserWithFacilities | null>(null);
  const [editForm, setEditForm] = useState({ name: '', role: 'VIEWER' as Role, password: '' });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Facility assignment modal
  const [assigningUser, setAssigningUser] = useState<UserWithFacilities | null>(null);
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);
  const [assignSaving, setAssignSaving] = useState(false);

  const reload = async () => {
    const [usersRes, facilitiesRes] = await Promise.all([getUsers(), getFacilities()]);
    setUsers(usersRes.data.users);
    setFacilities(facilitiesRes.data.facilities);
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreateSaving(true);
    try {
      await createUser(newUser);
      setNewUser({ email: '', password: '', name: '', role: 'VIEWER' });
      setShowCreate(false);
      reload();
    } catch (err: unknown) {
      setCreateError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create user'
      );
    } finally {
      setCreateSaving(false);
    }
  };

  const openEdit = (u: UserWithFacilities) => {
    setEditingUser(u);
    setEditForm({ name: u.name, role: u.role, password: '' });
    setEditError('');
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    setEditError('');
    setEditSaving(true);
    try {
      const data: { name: string; role: string; password?: string } = {
        name: editForm.name,
        role: editForm.role,
      };
      if (editForm.password) data.password = editForm.password;
      await updateUser(editingUser.id, data);
      setEditingUser(null);
      reload();
    } catch (err: unknown) {
      setEditError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to update user'
      );
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleActive = async (u: UserWithFacilities) => {
    if (!confirm(`${u.isActive ? 'Deactivate' : 'Activate'} ${u.name}?`)) return;
    await updateUser(u.id, { isActive: !u.isActive });
    reload();
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm('Delete this user? This cannot be undone.')) return;
    await deleteUser(id);
    reload();
  };

  const openAssign = (u: UserWithFacilities) => {
    setAssigningUser(u);
    setSelectedFacilities(u.facilities?.map((f) => f.facilityId) ?? []);
  };

  const handleSaveAssignment = async () => {
    if (!assigningUser) return;
    setAssignSaving(true);
    await assignFacilities(assigningUser.id, selectedFacilities);
    setAssigningUser(null);
    setAssignSaving(false);
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
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-500 text-sm mt-1">
            {users.length} {users.length === 1 ? 'user' : 'users'}
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setCreateError(''); }}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Add User
        </button>
      </div>

      {/* Create user modal */}
      {showCreate && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Create New User</h2>
            {createError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
                {createError}
              </div>
            )}
            <form onSubmit={handleCreateUser} className="space-y-4">
              {([
                { label: 'Full Name', key: 'name', type: 'text' },
                { label: 'Email', key: 'email', type: 'email' },
                { label: 'Password', key: 'password', type: 'password' },
              ] as const).map(({ label, key, type }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    type={type}
                    required
                    value={newUser[key]}
                    onChange={(e) => setNewUser((u) => ({ ...u, [key]: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value as Role }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={createSaving}
                  className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  {createSaving ? 'Creating…' : 'Create User'}
                </button>
                <button type="button" onClick={() => setShowCreate(false)} className="text-sm text-gray-600 hover:text-gray-800">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 font-medium text-gray-500 whitespace-nowrap">User</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500 whitespace-nowrap">Role</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500 whitespace-nowrap">Facility Access</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500 whitespace-nowrap">Status</th>
                <th className="text-left px-5 py-3 font-medium text-gray-500 whitespace-nowrap">Last Login</th>
                <th className="text-right px-5 py-3 font-medium text-gray-500 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((u) => (
                <tr key={u.id} className={`hover:bg-gray-50 transition-colors ${!u.isActive ? 'opacity-60' : ''}`}>
                  <td className="px-5 py-4">
                    <p className="font-medium text-gray-900">{u.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{u.email}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[u.role]}`}>
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className="px-5 py-4 max-w-[220px]">
                    {u.role === 'ADMIN' ? (
                      <span className="text-xs text-gray-400 italic">All facilities</span>
                    ) : u.facilities && u.facilities.length > 0 ? (
                      <span className="text-xs text-gray-600">
                        {u.facilities.map((f) => f.facility.name).join(', ')}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">None assigned</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {u.isActive ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-xs text-gray-500 whitespace-nowrap">
                    {formatLastLogin(u.lastLoginAt)}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      <button
                        onClick={() => openEdit(u)}
                        className="text-xs text-brand-600 hover:text-brand-700 border border-brand-200 hover:border-brand-400 px-2.5 py-1 rounded transition-colors"
                      >
                        Edit
                      </button>
                      {u.role !== 'ADMIN' && (
                        <button
                          onClick={() => openAssign(u)}
                          className="text-xs text-brand-600 hover:text-brand-700 border border-brand-200 hover:border-brand-400 px-2.5 py-1 rounded transition-colors"
                        >
                          Facilities
                        </button>
                      )}
                      {u.id !== currentUser?.id && (
                        <>
                          <button
                            onClick={() => handleToggleActive(u)}
                            className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 px-2.5 py-1 rounded transition-colors"
                          >
                            {u.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            onClick={() => handleDeleteUser(u.id)}
                            className="text-xs text-red-500 hover:text-red-700 transition-colors"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">No users found.</div>
          )}
        </div>
      </div>

      {/* Edit user modal */}
      {editingUser && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEditingUser(null); }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-1">Edit User</h2>
            <p className="text-sm text-gray-500 mb-4">{editingUser.email}</p>
            {editError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
                {editError}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as Role }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New Password <span className="text-gray-400 font-normal text-xs">(leave blank to keep current)</span>
                </label>
                <input
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={handleSaveEdit}
                disabled={editSaving}
                className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
              <button onClick={() => setEditingUser(null)} className="text-sm text-gray-600 hover:text-gray-800">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Facility assignment modal */}
      {assigningUser && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setAssigningUser(null); }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-1">Assign Facilities</h2>
            <p className="text-sm text-gray-500 mb-4">
              Select which facilities <strong>{assigningUser.name}</strong> can access.
            </p>
            {facilities.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No facilities have been set up yet.</p>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {facilities.map((f) => (
                  <label key={f.id} className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selectedFacilities.includes(f.id)}
                      onChange={(e) =>
                        setSelectedFacilities((prev) =>
                          e.target.checked ? [...prev, f.id] : prev.filter((id) => id !== f.id)
                        )
                      }
                      className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="text-sm text-gray-900">{f.name}</span>
                    <span className="text-xs text-gray-400 ml-auto">{f.city}, {f.state}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex gap-3 mt-5">
              <button
                onClick={handleSaveAssignment}
                disabled={assignSaving}
                className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {assignSaving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setAssigningUser(null)} className="text-sm text-gray-600 hover:text-gray-800">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
