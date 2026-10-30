import { useCallback, useEffect, useState } from 'react';
import * as gov from '../../services/governanceApi';
import type { GovUser, Role } from '../../services/governanceApi';
import { getLocalUser, setLocalUserName } from '../../services/identity';

const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, plus users, roles and settings',
  lead: 'Approve / reject, finalize, commit to Git, sync tickets',
  contributor: 'Upload documents, answer Q&A, generate content',
  viewer: 'Read only',
};

/** Users and their roles. Only admins can change a role. */
export default function UsersRoles() {
  const [me, setMe] = useState<GovUser | null>(null);
  const [users, setUsers] = useState<GovUser[]>([]);
  const [name, setName] = useState(getLocalUser().name);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [meNow, all] = await Promise.all([gov.getMe(), gov.listUsers()]);
      setMe(meNow);
      setUsers(all);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = async (user: GovUser, role: Role) => {
    setSavingId(user.id);
    setError(null);
    try {
      const updated = await gov.setUserRole(user.id, role);
      setUsers((list) => list.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  const saveName = async () => {
    setLocalUserName(name);
    await load();
  };

  const isAdmin = me?.role === 'admin';

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-stone-200 bg-white p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500 space-y-1">
          <span className="block font-semibold uppercase tracking-wider">Your display name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-white border border-stone-300 rounded-lg px-3 py-1.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-teal-600/30"
          />
        </label>
        <button onClick={() => void saveName()} className="text-sm px-3 py-1.5 rounded-lg bg-teal-700 text-white hover:bg-teal-800">
          Save
        </button>
        {me && (
          <span className="text-sm text-slate-600">
            Your role: <span className="font-semibold text-slate-800">{me.role}</span>
          </span>
        )}
      </div>

      {error && <div className="text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">User</th>
              <th className="px-3 py-2 text-left font-semibold">Role</th>
              <th className="px-3 py-2 text-left font-semibold">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-3 py-2">
                  <div className="text-slate-800">
                    {u.name}
                    {u.id === me?.id && <span className="ml-1 text-xs text-teal-700">(you)</span>}
                  </div>
                  <div className="text-xs font-mono text-slate-400">{u.id}</div>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={u.role}
                    disabled={!isAdmin || savingId === u.id}
                    onChange={(e) => void changeRole(u, e.target.value as Role)}
                    aria-label={`Role for ${u.name}`}
                    className="bg-white border border-stone-300 rounded-lg px-2.5 py-1.5 text-sm text-slate-800 outline-none disabled:bg-stone-50 disabled:text-slate-500"
                  >
                    {gov.ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-slate-400 mt-0.5">{ROLE_HELP[u.role]}</div>
                </td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{new Date(u.lastSeenAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        {isAdmin ? 'Changes apply to the next request the user makes.' : 'Only an admin can change roles.'} Identity is
        browser-based and not yet authenticated — connect SSO before relying on roles for security.
      </p>
    </div>
  );
}
