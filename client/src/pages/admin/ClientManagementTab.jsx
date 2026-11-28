import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import ConfigEditor from '../../components/ConfigEditor';
import { CLIENT_SECTIONS } from './adminConstants';

// ═══════════════════════════════════════════════════════════════
// TAB 1: Client Management (Tenants + Users + Client Config)
// ═══════════════════════════════════════════════════════════════

/**
 * `section` (2026-08-27) — render ONE section and hide the internal tab row.
 *
 * The four sections here (Clients · Users · Client Config · Client Connectors) belong to two
 * different groups in the reorganised admin: Clients and Users are not client-scoped, while
 * Client Config and Client Connectors are. Splitting them across the new top-level groups means
 * this component must be able to show one section without also drawing a tab row that contradicts
 * the group the reader is standing in.
 *
 * Omitted, it behaves exactly as before — its own tabs, its own state. Nothing about what any
 * section DOES changes; only whether its siblings are offered alongside it.
 *
 * Note: `initialSubTab` was already being passed by AdminPage and was never a parameter, so
 * Setup → Clients silently rendered the default section. That is why two tabs appeared to show
 * the same screen.
 */
function ClientManagementTab({ user, msg, setMsg, section }) {
  const [tenants, setTenants] = useState([]);
  const [users, setUsers] = useState([]);
  const [prices, setPrices] = useState([]);
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  // Initial sub-tab honours ?subtab=... in the URL when present (used
  // by the OAuth round-trip flow to land back on the Client Connectors
  // sub-tab after Google consent). Falls back to the role default.
  const [subTab, setSubTab] = useState(() => {
    // A pinned section wins over everything, including ?subtab= — the caller has already decided
    // which group the reader is in, and a URL left over from the old layout must not move them.
    if (section) return section;
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('subtab');
      const valid = ['tenants', 'users', 'clientconfig'];
      if (fromUrl && valid.includes(fromUrl)) return fromUrl;
    } catch { /* ignore — fall through to default */ }
    return user?.isSuperAdmin ? 'tenants' : 'users';
  });

  // Keep the pinned section authoritative if the caller switches groups without remounting.
  React.useEffect(() => { if (section) setSubTab(section); }, [section]);

  // ─── New Client form (info + license + config all-in-one) ────
  const [nc, setNc] = useState({
    name: '', domain: '',
    adminSeats: 1, standardSeats: 10, basicSeats: 50, discount: 0, term: 'M',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
  });

  const [availableTiers, setAvailableTiers] = useState([]);

  // ─── New User form ───────────────────────────────────────────
  const [newUser, setNewUser] = useState({ empcode: '', name: '', email: '', password: '', userType: 'ST', department: '', clientNumber: '', expiresAt: '', knowledgeModel: 'nexeo' });
  // "Is this a demo user?" toggle. When ON, expiresAt becomes required
  // and the date picker is revealed. demoExpirySuspendJob auto-suspends
  // the user at the chosen time.
  const [isDemo, setIsDemo] = useState(false);
  const [demoExpiryDate, setDemoExpiryDate] = useState(''); // YYYY-MM-DD format from <input type="date">
  const [demoDays, setDemoDays] = useState(7); // quick-pick days from now
  // Invitation toggle — true (default) means user sets own password
  // via emailed link, so the password input is hidden + skipped.
  // (Named with "Toggle" suffix to avoid colliding with the existing
  // sendInvite() function defined further down for resending invites.)
  const [sendInviteToggle, setSendInviteToggle] = useState(true);

  // ─── Edit User + Integration ────────────────────────────────
  const [editUser, setEditUser] = useState(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    // Each fetch handles its own failure so one broken endpoint can't
    // wipe the rest of the page. Previously a single failing call
    // (e.g. /tiers 401 or /licenses/prices 500) rejected the whole
    // Promise.all and the empty catch swallowed it — leaving Users (0)
    // even though /admin/users had returned 3 users. Per Basit 2026-06-10.
    if (user?.isSuperAdmin) {
      api.get('/tenants').then(r => setTenants(r.data.tenants || [])).catch(() => {});
      api.get('/licenses/prices').then(r => setPrices(r.data.prices || [])).catch(() => {});
    }
    api.get('/admin/users').then(r => setUsers(r.data.users || [])).catch(() => {});
    api.get('/tiers').then(r => setAvailableTiers(r.data.tiers || [])).catch(() => {});
  };

  const priceMap = {};
  prices.forEach(p => { priceMap[p.roleType] = Number(p.pricePerSeat); });

  // ─── Create Client (info + license in one step) ──────────────
  const createTenant = async () => {
    if (!nc.name) { setMsg('Company name is required'); return; }
    try {
      // Step 1: Create tenant
      const res = await api.post('/tenants', { name: nc.name, domain: nc.domain });
      const cn = res.data.tenant.clientNumber;

      // Step 2: Assign license
      await api.put(`/tenants/${cn}/license`, {
        adminSeats: nc.adminSeats, standardSeats: nc.standardSeats, basicSeats: nc.basicSeats,
        discount: nc.discount, term: nc.term, startDate: nc.startDate, endDate: nc.endDate,
      });

      setMsg(`Client ${cn} created with license`);
      setNc({ name: '', domain: '', adminSeats: 1, standardSeats: 10, basicSeats: 50, discount: 0, term: 'M',
        startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10) });
      setShowCreateTenant(false);
      loadAll();
    } catch (err) { setMsg(err.response?.data?.error || 'Failed to create client'); }
  };

  // ─── Create User ─────────────────────────────────────────────
  const createUser = async () => {
    // Required fields. Password is conditionally required: when the
    // admin checks "Send invitation email", the new user sets their
    // own password via the link, so we don't ask the admin for it.
    const shouldInvite = sendInviteToggle;
    if (!newUser.empcode || !newUser.name || !newUser.email) { setMsg('Employee code, name, and email are required'); return; }
    if (!shouldInvite && !newUser.password) { setMsg('Password required when not sending an invitation email'); return; }
    const targetClient = user?.isSuperAdmin ? newUser.clientNumber : user?.clientNumber;
    if (!targetClient) { setMsg('Please select a client'); return; }
    try {
      // When inviting, send a random throwaway password — the server
      // accepts it as the bcrypt seed but the invitation flow
      // overwrites it as soon as the user picks their own. Must satisfy
      // the password policy (length≥8, upper, digit, special).
      const makeThrowaway = () => {
        const rand = Math.random().toString(36).slice(2, 10);
        return `Tmp-${rand}9!`;
      };
      const password = newUser.password || (shouldInvite ? makeThrowaway() : '');
      // Resolve expiresAt: when "Demo" is on, prefer the explicit date
      // picker; if blank, fall back to days-from-now quick-pick. Final
      // value sent as ISO-8601 datetime (server expects .datetime()).
      let expiresAt = null;
      if (isDemo) {
        if (demoExpiryDate) {
          // Date picker is YYYY-MM-DD — set to end-of-day UTC so admin
          // gets a full day of access on the chosen date.
          expiresAt = new Date(`${demoExpiryDate}T23:59:59.000Z`).toISOString();
        } else if (demoDays > 0) {
          const d = new Date(Date.now() + demoDays * 24 * 60 * 60 * 1000);
          expiresAt = d.toISOString();
        } else {
          setMsg('Demo user needs an expiry date or days-from-now value'); return;
        }
      }
      const res = await api.post('/user/users', {
        ...newUser, password, clientNumber: targetClient,
        // null for a permanent user: the form's own '' is not a date and the server refuses it.
        expiresAt,
      });
      if (shouldInvite && res.data.user?.id) {
        await api.post(`/user/users/${res.data.user.id}/invite`, { baseUrl: window.location.origin }).catch(() => {});
        setMsg(isDemo ? 'Demo user created, invitation sent — will auto-suspend at expiry' : 'User created and invitation sent');
      } else {
        setMsg(isDemo ? 'Demo user created — will auto-suspend at expiry' : 'User created');
      }
      setNewUser({ empcode: '', name: '', email: '', password: '', userType: 'ST', department: '', clientNumber: '', expiresAt: '', knowledgeModel: 'nexeo' });
      setIsDemo(false);
      setDemoExpiryDate('');
      setDemoDays(7);
      setShowCreateUser(false);
      loadAll();
    } catch (err) { setMsg(err.response?.data?.error || 'Failed'); }
  };

  const resetPassword = async (empcode) => {
    try {
      const res = await api.post(`/user/users/${empcode}/reset-password`);
      setMsg(`Password reset for ${empcode}: ${res.data.tempPassword}`);
    } catch (err) { setMsg(err.response?.data?.error || 'Failed'); }
  };

  const sendInvite = async (userId) => {
    try {
      await api.post(`/user/users/${userId}/invite`, { baseUrl: window.location.origin });
      setMsg('Invitation email sent');
      return true;
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to send invitation');
      return false;
    }
  };

  const toggleTenantActive = async (cn, active) => {
    await api.patch(`/tenants/${cn}`, { isActive: !active }).catch(() => {});
    loadAll();
  };

  const calcGross = () => (nc.adminSeats * (priceMap['AD'] || 0)) + (nc.standardSeats * (priceMap['ST'] || 0)) + (nc.basicSeats * (priceMap['BS'] || 0));

  return (
    <>
      {/* Sub-tabs — hidden when the caller pinned a single section. */}
      <div className="config-tabs sub-tabs" style={section ? { display: 'none' } : undefined}>
        {user?.isSuperAdmin && <button className={`config-tab ${subTab === 'tenants' ? 'active' : ''}`} onClick={() => setSubTab('tenants')}>Clients</button>}
        <button className={`config-tab ${subTab === 'users' ? 'active' : ''}`} onClick={() => setSubTab('users')}>Users</button>
        <button className={`config-tab ${subTab === 'clientconfig' ? 'active' : ''}`} onClick={() => setSubTab('clientconfig')}>Client Config</button>
      </div>

      {/* ═══ Clients (SuperAdmin) ═══ */}
      {subTab === 'tenants' && user?.isSuperAdmin && (
        <section className="settings-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Clients ({tenants.length})</h2>
            <button className="settings-btn" onClick={() => setShowCreateTenant(!showCreateTenant)}>
              {showCreateTenant ? 'Cancel' : '+ New Client'}
            </button>
          </div>

          {/* Create Client — Full Form (Info + License) */}
          {showCreateTenant && (
            <div className="admin-create-form">
              <h3 style={{ fontSize: 14, color: 'var(--n-e8e8e0)', marginBottom: 12 }}>Client Information</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="settings-field"><label>Company Name *</label><input value={nc.name} onChange={e => setNc(c => ({ ...c, name: e.target.value }))} placeholder="Pakistan State Oil" /></div>
                <div className="settings-field"><label>Domain</label><input value={nc.domain} onChange={e => setNc(c => ({ ...c, domain: e.target.value }))} placeholder="pso.com.pk" /></div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--n-888888)', margin: '4px 0 16px' }}>Client number auto-generated from name</p>

              <h3 style={{ fontSize: 14, color: 'var(--n-e8e8e0)', marginBottom: 12, paddingTop: 12, borderTop: '1px solid var(--n-333333)' }}>License Allocation</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div className="settings-field"><label>AD Seats (${priceMap['AD'] || '?'}/seat)</label><input type="number" min="0" value={nc.adminSeats} onChange={e => setNc(c => ({ ...c, adminSeats: parseInt(e.target.value) || 0 }))} /></div>
                <div className="settings-field"><label>ST Seats (${priceMap['ST'] || '?'}/seat)</label><input type="number" min="0" value={nc.standardSeats} onChange={e => setNc(c => ({ ...c, standardSeats: parseInt(e.target.value) || 0 }))} /></div>
                <div className="settings-field"><label>BS Seats (${priceMap['BS'] || '?'}/seat)</label><input type="number" min="0" value={nc.basicSeats} onChange={e => setNc(c => ({ ...c, basicSeats: parseInt(e.target.value) || 0 }))} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                <div className="settings-field"><label>Discount %</label><input type="number" min="0" max="100" value={nc.discount} onChange={e => setNc(c => ({ ...c, discount: parseFloat(e.target.value) || 0 }))} /></div>
                <div className="settings-field"><label>Term</label>
                  <select value={nc.term} onChange={e => setNc(c => ({ ...c, term: e.target.value }))}>
                    <option value="M">Monthly</option><option value="Q">Quarterly</option><option value="Y">Yearly</option>
                  </select>
                </div>
                <div className="settings-field"><label>Start</label><input type="date" value={nc.startDate} onChange={e => setNc(c => ({ ...c, startDate: e.target.value }))} /></div>
                <div className="settings-field"><label>End</label><input type="date" value={nc.endDate} onChange={e => setNc(c => ({ ...c, endDate: e.target.value }))} /></div>
              </div>

              {/* Price summary */}
              {(() => {
                const gross = calcGross();
                const disc = gross * (nc.discount / 100);
                return (
                  <div style={{ background: 'var(--n-1a1a1a)', borderRadius: 8, padding: 12, margin: '10px 0', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--n-888888)' }}>Gross: ${gross.toLocaleString()}{nc.discount > 0 ? ` − ${nc.discount}%` : ''}</span>
                    <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Net: ${(gross - disc).toLocaleString()}/period</span>
                  </div>
                );
              })()}

              <button className="settings-btn" onClick={createTenant} style={{ width: '100%' }}>Create Client with License</button>
            </div>
          )}

          {/* Client table */}
          <table className="admin-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Client #</th><th>Name</th><th>Domain</th><th>Users</th><th>License</th><th>Expiry</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {tenants.map(t => (
                <TenantRow key={t.clientNumber} tenant={t} onToggle={toggleTenantActive} onSaved={loadAll} setMsg={setMsg} />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ═══ Users ═══ */}
      {subTab === 'users' && (
        <section className="settings-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Users ({users.length})</h2>
            <button className="settings-btn" onClick={() => setShowCreateUser(!showCreateUser)}>
              {showCreateUser ? 'Cancel' : '+ New User'}
            </button>
          </div>
          {showCreateUser && (
            <div className="admin-create-form">
              {/* Client selector: SA can pick, AD sees own client locked */}
              <div className="settings-field">
                <label>Client</label>
                {user?.isSuperAdmin ? (
                  <select value={newUser.clientNumber} onChange={e => setNewUser(u => ({ ...u, clientNumber: e.target.value }))}>
                    <option value="">Select client...</option>
                    {tenants.map(t => <option key={t.clientNumber} value={t.clientNumber}>{t.clientNumber} — {t.name}</option>)}
                  </select>
                ) : (
                  <input value={user?.clientNumber} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="settings-field"><label>Employee Code *</label><input value={newUser.empcode} onChange={e => setNewUser(u => ({ ...u, empcode: e.target.value }))} placeholder="EMP-001" /></div>
                <div className="settings-field"><label>Full Name *</label><input value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))} placeholder="Ahmed Khan" /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: sendInviteToggle ? '1fr' : '1fr 1fr', gap: 10 }}>
                <div className="settings-field"><label>Email *</label><input value={newUser.email} onChange={e => setNewUser(u => ({ ...u, email: e.target.value }))} placeholder="ahmed@company.com" /></div>
                {/* Password input hides when "Send invitation email" is on
                     — the user picks their own password via the email
                     link, so asking the admin to invent one was confusing
                     and contradicted the invitation flow. */}
                {!sendInviteToggle && (
                  <div className="settings-field">
                    <label>Password *</label>
                    <input type="password" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))} placeholder="Min 6 chars" />
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="settings-field"><label>User Type</label>
                  <select value={newUser.userType} onChange={e => setNewUser(u => ({ ...u, userType: e.target.value }))}>
                    {/* Fallback options always available so the dropdown
                         is never empty. SA only visible to super-admins;
                         AD + ST always visible. Tier-based options layer
                         on top when a tier admin has configured them. */}
                    {user?.isSuperAdmin && <option value="SA">SA — SuperAdmin</option>}
                    <option value="AD">AD — Admin</option>
                    <option value="ST">ST — Standard</option>
                    {availableTiers.filter(t => t.is_active && !['SA', 'AD', 'ST'].includes(t.tier_code)).map(t => (
                      <option key={t.tier_code} value={t.tier_code}>{t.tier_code} — {t.tier_name} (${Number(t.price_per_seat).toFixed(0)}/seat)</option>
                    ))}
                  </select>
                </div>
                <div className="settings-field"><label>Department</label><input value={newUser.department} onChange={e => setNewUser(u => ({ ...u, department: e.target.value }))} placeholder="Optional" /></div>
              </div>
              {/* Nexeo Owned Data or Client Owned Data (founder, 19 Nov 2026). Chosen here, once:
                   the server has no way to change it afterwards. */}
              <div className="settings-field" style={{ marginTop: 8 }}>
                <label>Knowledge</label>
                <select value={newUser.knowledgeModel} onChange={e => setNewUser(u => ({ ...u, knowledgeModel: e.target.value }))}>
                  <option value="nexeo">Nexeo Owned Data — knowledge is kept in the Nexeo wiki</option>
                  <option value="external">Client Owned Data — knowledge stays in the user's own Obsidian vault</option>
                </select>
                {newUser.knowledgeModel === 'external' && (
                  <div style={{ fontSize: 12, color: 'var(--n-bbbbbb)', marginTop: 4 }}>
                    Nexeo fetches and stores nothing for this user and works only while the user's Mac is on. This cannot be changed after the user is created.
                  </div>
                )}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--n-bbbbbb)', marginTop: 8 }}>
                <input
                  type="checkbox"
                  id="sendInvite"
                  checked={sendInviteToggle}
                  onChange={(e) => setSendInviteToggle(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                Send invitation email (user sets their own password)
              </label>
              {/* Demo user toggle — when on, account auto-suspends at the
                  chosen expiry (reversible; admin can extend or hard-delete). */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--n-bbbbbb)', marginTop: 8 }}>
                <input
                  type="checkbox"
                  id="isDemo"
                  checked={isDemo}
                  onChange={(e) => setIsDemo(e.target.checked)}
                  style={{ accentColor: 'var(--s-f59e0b)' }}
                />
                Demo user (auto-suspend at expiry)
              </label>
              {isDemo && (
                <div style={{ background: 'var(--n-1a1610)', border: '1px solid color-mix(in srgb, var(--s-f59e0b) 26.6667%, transparent)', borderRadius: 8, padding: 10, marginTop: 6 }}>
                  <div style={{ fontSize: 12, color: 'var(--s-f59e0b)', marginBottom: 8 }}>
                    Expires at — pick a date OR set days from now. Account auto-suspends at this time (reversible).
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="settings-field" style={{ flex: '1 1 180px', marginBottom: 0 }}>
                      <label style={{ fontSize: 11 }}>Exact date</label>
                      <input
                        type="date"
                        value={demoExpiryDate}
                        min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                        onChange={(e) => { setDemoExpiryDate(e.target.value); setDemoDays(0); }}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div style={{ color: 'var(--n-666666)', fontSize: 12, padding: '0 4px 6px' }}>or</div>
                    <div className="settings-field" style={{ flex: '0 0 140px', marginBottom: 0 }}>
                      <label style={{ fontSize: 11 }}>Days from now</label>
                      <select
                        value={demoDays}
                        onChange={(e) => { setDemoDays(Number(e.target.value)); setDemoExpiryDate(''); }}
                        style={{ width: '100%' }}
                      >
                        <option value={0}>—</option>
                        <option value={1}>1 day</option>
                        <option value={3}>3 days</option>
                        <option value={7}>7 days</option>
                        <option value={14}>14 days</option>
                        <option value={30}>30 days</option>
                        <option value={60}>60 days</option>
                        <option value={90}>90 days</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
              <button className="settings-btn" onClick={async () => { await createUser(); }} style={{ width: '100%', marginTop: 8 }}>Create User</button>
            </div>
          )}
          <table className="admin-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Empcode</th><th>Name</th><th>Email</th><th>Type</th><th>Dept</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {users.map(u => (
                <React.Fragment key={u.id}>
                  <tr style={u.isActive ? {} : { opacity: 0.55 }}>
                    <td>{u.empcode}</td>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td><span className={`badge-type type-${u.userType}`}>{u.userType}</span></td>
                    <td>{u.department || '—'}</td>
                    <td>
                      {u.isActive
                        ? <span style={{ color: 'var(--s-4ade80)', fontSize: 11, fontWeight: 600 }}>● Active</span>
                        : <span style={{ color: 'var(--s-f59e0b)', fontSize: 11, fontWeight: 600 }}>◌ Suspended</span>}
                      {u.expiresAt && (() => {
                        const ms = new Date(u.expiresAt).getTime() - Date.now();
                        const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
                        const expired = ms <= 0;
                        return (
                          <div style={{
                            fontSize: 10, marginTop: 2,
                            color: expired ? 'var(--s-ef4444)' : days <= 3 ? 'var(--s-f59e0b)' : 'var(--n-888888)',
                          }}>
                            {expired
                              ? `⌛ Demo expired ${Math.abs(days)}d ago`
                              : `⌛ Demo: ${days}d left (${new Date(u.expiresAt).toLocaleDateString()})`}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button className="admin-action" onClick={() => setEditUser(editUser?.id === u.id ? null : u)}>
                        {editUser?.id === u.id ? 'Close' : 'Edit'}
                      </button>
                      <InviteButton userId={u.id} onInvite={sendInvite} />
                      <button className="admin-action" onClick={() => resetPassword(u.empcode)}>Reset</button>
                      {u.id !== user?.id && (
                        u.isActive ? (
                          <SuspendButton userId={u.id} userName={u.name} onAfter={loadAll} setMsg={setMsg} />
                        ) : (
                          <ReactivateButton userId={u.id} userName={u.name} onAfter={loadAll} setMsg={setMsg} />
                        )
                      )}
                      {u.id !== user?.id && u.userType !== 'SA' && (
                        <DeleteUserButton user={u} onAfter={loadAll} setMsg={setMsg} />
                      )}
                    </td>
                  </tr>
                  {editUser?.id === u.id && (
                    <tr><td colSpan={7} style={{ padding: 0 }}>
                      <EditUserPanel user={u} availableTiers={availableTiers} isSuperAdmin={user?.isSuperAdmin} onUpdate={() => { loadAll(); setMsg('User updated'); }} onMsg={setMsg} />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ═══ Client Config (SMTP, GDrive raw keys) ═══ */}
      {subTab === 'clientconfig' && (
        <ClientConfigSection user={user} tenants={tenants} />
      )}

      {/* Client Connectors (tenant knowledge sources: the client's Drive folder) removed 28 Nov 2026, founder: "remove
          client specific - knowledge Source, because it will be converted to integrations". */}
    </>
  );
}

// ─── Suspend / Reactivate / Delete buttons ────────────────────────
//
// Inline typed-phrase confirmation pattern per [[feedback_no_browser_dialogs]]
// — never window.confirm; the confirm step is rendered IN the row so
// the admin sees exactly what they're about to do.

function SuspendButton({ userId, userName, onAfter, setMsg }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming) {
    return (
      <button
        className="admin-action"
        onClick={() => setConfirming(true)}
        title="Block login + stop all Brain → user communication (reversible)"
      >
        Suspend
      </button>
    );
  }
  return (
    <>
      <button
        className="admin-action"
        style={{ borderColor: 'var(--s-f59e0b)', color: 'var(--s-f59e0b)' }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post(`/admin/users/${userId}/suspend`);
            setMsg(`${userName} suspended — login blocked, all comms stopped. Reversible.`);
            setConfirming(false);
            onAfter?.();
          } catch (e) {
            setMsg(`Suspend failed: ${e?.response?.data?.error ?? e.message}`);
          } finally { setBusy(false); }
        }}
      >
        {busy ? '…' : 'Yes, Suspend'}
      </button>
      <button className="admin-action" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
    </>
  );
}

function ReactivateButton({ userId, userName, onAfter, setMsg }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="admin-action"
      style={{ borderColor: 'var(--s-4ade80)', color: 'var(--s-4ade80)' }}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post(`/admin/users/${userId}/reactivate`);
          setMsg(`${userName} reactivated — login restored.`);
          onAfter?.();
        } catch (e) {
          setMsg(`Reactivate failed: ${e?.response?.data?.error ?? e.message}`);
        } finally { setBusy(false); }
      }}
    >
      {busy ? '…' : 'Reactivate'}
    </button>
  );
}

function DeleteUserButton({ user, onAfter, setMsg }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const expected = `DELETE ${user.email}`;
  if (!open) {
    return (
      <button
        className="admin-action"
        style={{ borderColor: 'var(--s-ef4444)', color: 'var(--s-ef4444)' }}
        onClick={() => setOpen(true)}
        title="Permanently delete user + all data (NOT reversible)"
      >
        Delete
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input
        value={confirmText}
        onChange={e => setConfirmText(e.target.value)}
        placeholder={expected}
        style={{ fontSize: 11, padding: '2px 6px', minWidth: 220, background: 'var(--n-1a1010)', border: '1px solid var(--s-ef4444)', color: 'var(--s-fca5a5)' }}
      />
      <button
        className="admin-action"
        style={{
          borderColor: 'var(--s-ef4444)',
          color: 'var(--s-ef4444)',
          opacity: confirmText === expected && !busy ? 1 : 0.4,
        }}
        disabled={confirmText !== expected || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.delete(`/admin/users/${user.id}`, { data: { confirm: confirmText } });
            setMsg(`${user.name} deleted permanently. All their data removed.`);
            setOpen(false);
            setConfirmText('');
            onAfter?.();
          } catch (e) {
            setMsg(`Delete failed: ${e?.response?.data?.error ?? e.message}`);
          } finally { setBusy(false); }
        }}
      >
        {busy ? '…' : 'Delete'}
      </button>
      <button className="admin-action" disabled={busy} onClick={() => { setOpen(false); setConfirmText(''); }}>Cancel</button>
    </span>
  );
}

function InviteButton({ userId, onInvite }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handle = async () => {
    setSending(true);
    const ok = await onInvite(userId);
    setSending(false);
    if (ok) { setSent(true); setTimeout(() => setSent(false), 3000); }
  };

  return (
    <button
      className="admin-action"
      onClick={handle}
      disabled={sending}
      title="Send invitation email"
      style={sent ? { borderColor: 'var(--s-4ade80)', color: 'var(--s-4ade80)' } : sending ? { opacity: 0.5 } : {}}
    >
      {sending ? 'Sending...' : sent ? 'Sent ✓' : 'Invite'}
    </button>
  );
}

function ClientConfigSection({ user, tenants }) {
  const [selectedClient, setSelectedClient] = useState(user?.clientNumber || '');
  const targetClient = user?.isSuperAdmin ? selectedClient : undefined;
  const effectiveClient = user?.isSuperAdmin ? selectedClient : user?.clientNumber;

  return (
    <>
      <div style={{ marginBottom: 12, padding: '10px 14px', background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 6, fontSize: 12, color: 'var(--text)' }}>
        <strong>What lives here:</strong> SMTP + Foundation Drive folder pointers per tenant.<br />
        <strong>What used to live here but doesn't anymore:</strong> AI/RAG knobs, response controls, caching TTLs, Google OAuth keys — all either Brain-managed or moved to the platform OAuth client. Less to break, less to tune.
      </div>

      {/* Client selector */}
      <section className="settings-section" style={{ paddingBottom: 12 }}>
        <div className="settings-field">
          <label>Client</label>
          {user?.isSuperAdmin ? (
            <select value={selectedClient} onChange={e => setSelectedClient(e.target.value)}>
              {tenants.map(t => <option key={t.clientNumber} value={t.clientNumber}>{t.clientNumber} — {t.name}</option>)}
            </select>
          ) : (
            <input value={user?.clientNumber} disabled style={{ opacity: 0.6 }} />
          )}
        </div>
      </section>

      <ConfigEditor key={selectedClient} sections={CLIENT_SECTIONS} apiPath="/config" clientNumber={targetClient} />

      <SmtpHealthCheck clientNumber={effectiveClient} />

      <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(var(--n-888888-rgb),0.08)', border: '1px dashed rgba(var(--n-888888-rgb),0.3)', borderRadius: 6, fontSize: 12, color: 'var(--text-muted)' }}>
        Looking for FACL folder setup + scribe? That moved to the <strong>Client Connectors</strong> tab.
      </div>
    </>
  );
}

/** Test SMTP — verifies the tenant's SMTP credentials by performing an
 *  SMTP handshake. Does NOT deliver a message. Surfaces the real error
 *  string from nodemailer so admins can fix forgot-password / invite
 *  delivery without trawling pm2 logs. */
function SmtpHealthCheck({ clientNumber }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok: bool, msg: string }

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await api.post('/user/smtp-test', clientNumber ? { clientNumber } : {});
      const data = res.data || {};
      setResult(data.ok
        ? { ok: true, msg: data.fromAddr ? `Connected. Will send from ${data.fromAddr}.` : 'Connected.' }
        : { ok: false, msg: data.error || 'SMTP test failed' });
    } catch (err) {
      setResult({ ok: false, msg: err?.response?.data?.error || err?.message || 'Request failed' });
    } finally {
      setBusy(false);
    }
  };

  const colour = !result ? 'var(--text-muted)' : result.ok ? 'var(--s-4ade80)' : 'var(--s-f87171)';
  const bg = !result ? 'rgba(136,136,136,0.06)' : result.ok ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.10)';
  const border = !result ? 'rgba(136,136,136,0.3)' : result.ok ? 'rgba(74,222,128,0.45)' : 'rgba(248,113,113,0.55)';

  return (
    <div style={{ marginTop: 12, padding: '12px 14px', background: bg, border: `1px solid ${border}`, borderRadius: 6, fontSize: 13, color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ color: 'var(--text)' }}>SMTP health check</strong>
        <button className="admin-action" onClick={run} disabled={busy} style={busy ? { opacity: 0.5 } : {}}>
          {busy ? 'Testing…' : 'Test SMTP'}
        </button>
        {result && (
          <span style={{ color: colour, fontSize: 12 }}>
            {result.ok ? '✓' : '✗'} {result.msg}
          </span>
        )}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
        Performs an SMTP handshake using the credentials above. No email is sent. Run this after editing SMTP settings — and any time forgot-password or invite emails go missing.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Edit User Panel (inline, with integration setup)
// ═══════════════════════════════════════════════════════════════

function EditUserPanel({ user: u, availableTiers = [], isSuperAdmin, onUpdate, onMsg }) {
  const [form, setForm] = useState({
    name: u.name, department: u.department || '', userType: u.userType,
    city: u.city || '', contactNumber: u.contactNumber || '', jobDescription: u.jobDescription || '',
  });
  const [saving, setSaving] = useState(false);
  const [intStatus, setIntStatus] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => { loadIntStatus(); }, []);

  const loadIntStatus = async () => {
    try { const res = await api.get(`/integration/status/${u.id}`); setIntStatus(res.data); } catch {}
  };

  const saveUser = async () => {
    setSaving(true);
    try {
      await api.patch(`/admin/users/${u.id}`, form);
      onMsg('User updated');
      onUpdate();
    } catch (err) { onMsg(err.response?.data?.error || 'Failed to update user'); }
    setSaving(false);
  };

  const connectGoogle = async () => {
    try {
      const res = await api.get(`/integration/connect/${u.id}`);
      window.open(res.data.url, '_blank', 'width=600,height=700');
      // Poll for completion
      const poll = setInterval(async () => {
        const s = await api.get(`/integration/status/${u.id}`);
        if (s.data.connected) { clearInterval(poll); setIntStatus(s.data); onMsg(`Google connected: ${s.data.email}`); }
      }, 3000);
      setTimeout(() => clearInterval(poll), 120000); // stop polling after 2 min
    } catch (err) { onMsg(err.response?.data?.error || 'Failed to start connection'); }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const res = await api.post(`/integration/test/${u.id}`);
      if (res.data.success) {
        onMsg(`Integration OK — Email: ${res.data.email}, Calendars: ${res.data.calendarCount}`);
        setIntStatus({ ...intStatus, status: 'active', error: null, email: res.data.email });
      } else {
        onMsg(`Integration Error: ${res.data.error}`);
        setIntStatus({ ...intStatus, status: 'error', error: res.data.error });
      }
    } catch (err) { onMsg('Test failed'); }
    setTesting(false);
  };

  const disconnectGoogle = async () => {
    try {
      await api.delete(`/integration/disconnect/${u.id}`);
      setIntStatus({ connected: false });
      onMsg('Integration disconnected');
    } catch (err) { onMsg('Disconnect failed'); }
  };

  const inputStyle = { width: '100%', padding: '6px 10px', fontSize: 13, background: 'var(--n-2a2a2a)', border: '1px solid var(--n-444444)', borderRadius: 6, color: 'var(--n-eeeeee)' };

  return (
    <div style={{ background: 'var(--n-1a1a1a)', padding: 16, borderTop: '2px solid var(--s-cc6b4a)' }}>
      {/* ── User Details ── */}
      <h4 style={{ color: 'var(--s-cc6b4a)', margin: '0 0 12px 0', fontSize: 14 }}>Edit User: {u.name}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div><label style={{ fontSize: 11, color: 'var(--n-888888)' }}>Name</label><input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div><label style={{ fontSize: 11, color: 'var(--n-888888)' }}>Department</label><input style={inputStyle} value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} /></div>
        <div><label style={{ fontSize: 11, color: 'var(--n-888888)' }}>User Type</label>
          <select style={inputStyle} value={form.userType} onChange={e => setForm(f => ({ ...f, userType: e.target.value }))}>
            {isSuperAdmin && <option value="SA">SA — SuperAdmin</option>}
            {isSuperAdmin && <option value="AD">AD — Admin</option>}
            {availableTiers.filter(t => t.is_active).map(t => (
              <option key={t.tier_code} value={t.tier_code}>{t.tier_code} — {t.tier_name}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div><label style={{ fontSize: 11, color: 'var(--n-888888)' }}>City</label><input style={inputStyle} value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} /></div>
        <div><label style={{ fontSize: 11, color: 'var(--n-888888)' }}>Contact Number</label><input style={inputStyle} value={form.contactNumber} onChange={e => setForm(f => ({ ...f, contactNumber: e.target.value }))} /></div>
        <div><label style={{ fontSize: 11, color: 'var(--n-888888)' }}>Job Description</label><input style={inputStyle} value={form.jobDescription} onChange={e => setForm(f => ({ ...f, jobDescription: e.target.value }))} /></div>
      </div>
      <button className="settings-btn" onClick={saveUser} disabled={saving} style={{ marginBottom: 16 }}>
        {saving ? 'Saving...' : 'Save User Details'}
      </button>

      {/* ── Email & Calendar Integration ── */}
      <div style={{ borderTop: '1px solid var(--n-333333)', paddingTop: 12 }}>
        <h4 style={{ color: 'var(--s-cc6b4a)', margin: '0 0 10px 0', fontSize: 14 }}>Email & Calendar Integration</h4>

        {intStatus === null ? (
          <p style={{ color: 'var(--n-888888)', fontSize: 12 }}>Loading...</p>
        ) : !intStatus.connected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: 'var(--n-888888)', fontSize: 13 }}>Not connected</span>
            <button className="settings-btn" onClick={connectGoogle} style={{ padding: '6px 16px', fontSize: 12 }}>
              Connect Google (Gmail + Calendar)
            </button>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: intStatus.status === 'active' ? '#4ade80' : intStatus.status === 'expired' ? '#f59e0b' : '#ef4444',
              }} />
              <span style={{ fontSize: 13, color: 'var(--n-eeeeee)' }}>
                {intStatus.provider === 'google' ? 'Google' : 'Microsoft'} — {intStatus.email}
              </span>
              <span style={{ fontSize: 11, color: 'var(--n-888888)' }}>({intStatus.scopes})</span>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                background: intStatus.status === 'active' ? 'rgba(74,222,128,0.15)' : 'rgba(239,68,68,0.15)',
                color: intStatus.status === 'active' ? 'var(--s-4ade80)' : 'var(--s-ef4444)',
              }}>
                {intStatus.status}
              </span>
            </div>

            {intStatus.error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontSize: 12, color: 'var(--s-ef4444)' }}>
                Error: {intStatus.error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="admin-action" onClick={testConnection} disabled={testing} style={{ borderColor: 'var(--s-4ade80)', color: 'var(--s-4ade80)' }}>
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button className="admin-action" onClick={connectGoogle} style={{ borderColor: 'var(--s-f59e0b)', color: 'var(--s-f59e0b)' }}>
                Reconnect
              </button>
              <button className="admin-action" onClick={disconnectGoogle} style={{ borderColor: 'var(--s-ef4444)', color: 'var(--s-ef4444)' }}>
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tenant Row (used in Client table)
// ═══════════════════════════════════════════════════════════════

function TenantRow({ tenant: t, onToggle, onSaved, setMsg }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  const [domain, setDomain] = useState(t.domain || '');

  const save = async () => {
    try {
      await api.patch(`/tenants/${t.clientNumber}`, { name, domain: domain || null });
      setMsg(`Client ${t.clientNumber} updated`);
      setEditing(false);
      onSaved();
    } catch (err) { setMsg(err.response?.data?.error || 'Failed to update'); }
  };

  if (editing) {
    return (
      <tr>
        <td><strong>{t.clientNumber}</strong></td>
        <td><input value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', padding: '4px 8px', fontSize: 13, background: 'var(--bg-input)', border: '1px solid var(--accent)', borderRadius: 6, color: 'var(--n-ffffff)' }} /></td>
        <td><input value={domain} onChange={e => setDomain(e.target.value)} style={{ width: '100%', padding: '4px 8px', fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border-input)', borderRadius: 6, color: 'var(--n-bbbbbb)' }} placeholder="domain.com" /></td>
        <td>{t.userCount}</td>
        <td>{t.license ? <span style={{ fontSize: 11 }}>{t.license.adminSeats}AD/{t.license.standardSeats}ST/{t.license.basicSeats}BS</span> : <span style={{ color: 'var(--n-888888)', fontSize: 11 }}>None</span>}</td>
        <td>{t.expiry ? <span style={{ color: new Date(t.expiry) > new Date() ? 'var(--s-4ade80)' : 'var(--s-ef4444)', fontSize: 12 }}>{new Date(t.expiry).toLocaleDateString()}</span> : '—'}</td>
        <td><span className={`badge-type ${t.isActive ? 'type-ST' : 'type-SA'}`}>{t.isActive ? 'Active' : 'Inactive'}</span></td>
        <td style={{ display: 'flex', gap: 4 }}>
          <button className="admin-action" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={save}>Save</button>
          <button className="admin-action" onClick={() => setEditing(false)}>Cancel</button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td><strong>{t.clientNumber}</strong></td>
      <td>{t.name}</td>
      <td style={{ fontSize: 12, color: 'var(--n-888888)' }}>{t.domain || '—'}</td>
      <td>{t.userCount}</td>
      <td>{t.license ? <span style={{ fontSize: 11 }}>{t.license.adminSeats}AD/{t.license.standardSeats}ST/{t.license.basicSeats}BS</span> : <span style={{ color: 'var(--n-888888)', fontSize: 11 }}>None</span>}</td>
      <td>{t.expiry ? <span style={{ color: new Date(t.expiry) > new Date() ? 'var(--s-4ade80)' : 'var(--s-ef4444)', fontSize: 12 }}>{new Date(t.expiry).toLocaleDateString()}</span> : '—'}</td>
      <td><span className={`badge-type ${t.isActive ? 'type-ST' : 'type-SA'}`} style={{ cursor: 'pointer' }} onClick={() => onToggle(t.clientNumber, t.isActive)}>{t.isActive ? 'Active' : 'Inactive'}</span></td>
      <td><button className="admin-action" onClick={() => setEditing(true)}>Edit</button></td>
    </tr>
  );
}

export default ClientManagementTab;
export { TenantRow };
