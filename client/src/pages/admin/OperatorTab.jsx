import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

/**
 * Admin → Client Specific → Computer Operator (link T41, founder 18 Nov 2026).
 *
 * The operator works on each user's own computer, inside Suzi, with a model that runs there: nothing
 * it sees leaves that computer. This screen is the customer's control over it: consent, the on/off
 * switch, apps to keep hidden, the monthly limits, and how much was used. Each user's own
 * permissions (reading images, system jobs) are set by that user in Suzi, not here.
 */
export default function OperatorTab({ user, setMsg }) {
  const [data, setData] = useState(null);
  const [apps, setApps] = useState('');
  const [limits, setLimits] = useState({ monthlyTaskLimit: 100, monthlyStepLimit: 3000, maxSteps: 30 });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get('/admin/operator');
      setData(d);
      setApps((d.settings.blankApps || []).join(', '));
      setLimits({ monthlyTaskLimit: d.settings.monthlyTaskLimit, monthlyStepLimit: d.settings.monthlyStepLimit, maxSteps: d.settings.maxSteps });
    } catch (err) { setMsg(err.response?.data?.error || 'Could not read the operator settings'); }
  }, [setMsg]);

  useEffect(() => { load(); }, [load]);

  const save = async (body, done) => {
    setBusy(true);
    try {
      await api.put('/admin/operator', body);
      setMsg(done);
      await load();
    } catch (err) { setMsg(err.response?.data?.error || 'Could not save'); }
    setBusy(false);
  };

  if (!data) return <div className="settings-section"><p>Loading…</p></div>;
  const s = data.settings;
  const consented = !!s.consentAt;
  const on = consented && s.enabled;

  return (
    <>
      <div className="settings-section">
        <h2>Computer Operator</h2>
        <p>
          Suzi can work on a user's own computer: files, the browser, forms and settings. The model runs on that
          computer, so screens and file contents never leave it. Nexeo keeps only counts: how many tasks and steps,
          and how each ended.
        </p>
        <p><strong>Status for {data.clientNumber}:</strong> {on ? 'On' : consented ? 'Off (consent recorded)' : 'Off (no consent recorded)'}</p>
      </div>

      <div className="settings-section">
        <h3>1. Consent</h3>
        {consented
          ? <p>Recorded on {new Date(s.consentAt).toLocaleString()}.</p>
          : <p>Nothing runs until an admin of this client records consent for Suzi to operate its users' computers.</p>}
        {consented
          ? <button className="settings-btn danger" disabled={busy} onClick={() => save({ consent: false }, 'Consent withdrawn; the operator is off')}>Withdraw consent</button>
          : <button className="settings-btn" disabled={busy} onClick={() => save({ consent: true }, 'Consent recorded')}>Record consent</button>}
      </div>

      <div className="settings-section">
        <h3>2. Switch</h3>
        <p>{on ? 'The operator is on for this client.' : 'The operator is off for this client.'}</p>
        <button className={`settings-btn ${on ? 'danger' : ''}`} disabled={busy || !consented}
          onClick={() => save({ enabled: !s.enabled }, s.enabled ? 'Operator switched off' : 'Operator switched on')}>
          {s.enabled ? 'Switch off' : 'Switch on'}
        </button>
        {!consented && <p>Record consent first.</p>}
      </div>

      <div className="settings-section">
        <h3>3. Apps to keep hidden</h3>
        <p>Windows of these apps are blanked before the operator looks at the screen. Separate names with commas.</p>
        <div className="settings-field">
          <input type="text" value={apps} onChange={(e) => setApps(e.target.value)} placeholder="e.g. Keychain Access, 1Password" />
        </div>
        <button className="settings-btn" disabled={busy}
          onClick={() => save({ blankApps: apps.split(',').map((a) => a.trim()).filter(Boolean) }, 'Hidden apps saved')}>Save</button>
      </div>

      <div className="settings-section">
        <h3>4. This month</h3>
        <p>
          {data.usage.runs} of {s.monthlyTaskLimit} tasks, {data.usage.steps} of {s.monthlyStepLimit} steps.
          {Object.keys(data.usage.byStatus || {}).length > 0 && (
            <> Ended as: {Object.entries(data.usage.byStatus).map(([k, v]) => `${k} ${v}`).join(', ')}.</>
          )}
        </p>
        {user?.isSuperAdmin && (
          <>
            <div className="settings-field">
              <label>Tasks per month</label>
              <input type="number" min="0" value={limits.monthlyTaskLimit} onChange={(e) => setLimits({ ...limits, monthlyTaskLimit: Number(e.target.value) })} />
            </div>
            <div className="settings-field">
              <label>Steps per month</label>
              <input type="number" min="0" value={limits.monthlyStepLimit} onChange={(e) => setLimits({ ...limits, monthlyStepLimit: Number(e.target.value) })} />
            </div>
            <div className="settings-field">
              <label>Most steps in one task (1 to 100)</label>
              <input type="number" min="1" max="100" value={limits.maxSteps} onChange={(e) => setLimits({ ...limits, maxSteps: Number(e.target.value) })} />
            </div>
            <button className="settings-btn" disabled={busy} onClick={() => save(limits, 'Limits saved')}>Save limits</button>
          </>
        )}
      </div>
    </>
  );
}
