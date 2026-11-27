import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import SuziDesktopSection from '../components/SuziDesktopSection';

export default function SettingsPage() {
  const { user, logout, fontScale, fontScaleIsOverride, setFontScale, resetFontScaleToDefault } = useAuth();
  const navigate = useNavigate();
  // `gender` re-added 2026-06-10 — but with a different purpose than the
  // 2026-05-18 retired version. This is GRAMMATICAL gender (drives
  // English pronouns + Urdu verb endings in Brain's replies), not a
  // demographic profile field. Default 'female' per user request.
  const [profile, setProfile] = useState({ city: '', contactNumber: '', aboutMe: '', instructions: '', gender: 'female' });
  // Standing instructions live in My Rules (one rule set, 13 Nov). The old free-text box is shown only while it still holds text.
  const [hadInstructions, setHadInstructions] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/profile').then(res => {
      const p = res.data.profile || {};
      setProfile({ city: p.city || '', contactNumber: p.contactNumber || '', aboutMe: p.aboutMe || '', instructions: p.instructions || '', gender: p.gender || 'female' });
      setHadInstructions(!!(p.instructions || '').trim());
    }).catch(() => {});
  }, []);

  const saveProfile = async () => {
    setSaving(true);
    setMsg('');
    try {
      // What Suzi calls you is saved on the Assistant tab, so it is never sent (and overwritten) from here.
      const { instructions, ...rest } = profile;
      await api.put('/profile', hadInstructions ? profile : rest);
      setMsg('Profile saved');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to save');
    }
    setSaving(false);
  };

  const changePassword = async () => {
    if (!passwords.currentPassword || !passwords.newPassword) return;
    setSaving(true);
    setMsg('');
    try {
      await api.post('/user/change-password', passwords);
      setMsg('Password changed');
      setPasswords({ currentPassword: '', newPassword: '' });
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to change password');
    }
    setSaving(false);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const [intStatus, setIntStatus] = useState(null);

  useEffect(() => {
    api.get('/integration/status').then(r => setIntStatus(r.data)).catch(() => {});
  }, []);

  // Tone is auto-learned by AI from conversations — no manual setting needed

  const [tab, setTab] = useState('profile');
  // Founder 27 Nov: "keep it simple". Organisation tab removed (it held only the tenant text size).
  const tabs = [
    { id: 'profile',    label: 'Profile' },
    { id: 'assistant',  label: 'Assistant' },
    { id: 'openItems',  label: 'Open Items' },
    { id: 'suzi',       label: 'Suzi Apps' },
    { id: 'security',   label: 'Security' },
  ];

  return (
    <div className="settings-page">
      <div className="settings-container">
        <div className="settings-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1>Settings</h1>
          <a
            href="/welcome"
            onClick={(e) => { e.preventDefault(); window.location.assign('/welcome'); }}
            style={{
              fontSize: 12, color: 'var(--accent)', textDecoration: 'none',
              padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6,
              background: 'transparent', cursor: 'pointer',
            }}
            title="Re-open the new-user walkthrough"
          >
            👋 Walkthrough
          </a>
        </div>

        {msg && <div className={`settings-msg ${msg.includes('Failed') || msg.includes('incorrect') ? 'error' : ''}`}>{msg}</div>}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--n-333333)' }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 14px', background: 'transparent', border: 0, cursor: 'pointer',
                color: tab === t.id ? 'var(--s-cc6b4a)' : 'var(--n-888888)',
                borderBottom: tab === t.id ? '2px solid var(--s-cc6b4a)' : '2px solid transparent',
                fontSize: 13, textTransform: 'uppercase', letterSpacing: '.5px',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'profile' && (
          <>
            {/* Account (read-only) */}
            <section className="settings-section">
              <h2>Account</h2>
              <div className="settings-info">
                <div><span className="info-label">Name</span><span>{user?.name}</span></div>
                <div><span className="info-label">Email</span><span>{user?.email}</span></div>
                {user?.department && <div><span className="info-label">Department</span><span>{user.department}</span></div>}
              </div>
            </section>

            {/* Job Description (read-only) */}
            {user?.jobDescription && (
              <section className="settings-section">
                <h2>Job Description</h2>
                <p className="settings-readonly">{user.jobDescription}</p>
              </section>
            )}

            <section className="settings-section">
              <h2>About you</h2>
              <p style={{ fontSize: 12, color: 'var(--n-666666)', marginTop: -4, marginBottom: 10 }}>
                Nexeo and Suzi read these when they write for you or brief your day.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="settings-field">
                  <label>City</label>
                  <input value={profile.city} onChange={e => setProfile(p => ({ ...p, city: e.target.value }))} placeholder="e.g. Karachi" />
                </div>
                <div className="settings-field">
                  <label>Contact number</label>
                  <input value={profile.contactNumber} onChange={e => setProfile(p => ({ ...p, contactNumber: e.target.value }))} placeholder="e.g. +92 300 1234567" />
                </div>
              </div>
              <div className="settings-field">
                <label>Gender</label>
                <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                  {[
                    { value: 'female', label: 'Female' },
                    { value: 'male',   label: 'Male' },
                    { value: 'unspecified', label: 'Not specified' },
                  ].map(opt => (
                    <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input
                        type="radio"
                        name="gender"
                        value={opt.value}
                        checked={profile.gender === opt.value}
                        onChange={() => setProfile(p => ({ ...p, gender: opt.value }))}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--n-666666)', marginTop: 6 }}>
                  Used for pronouns and Urdu verb endings when Suzi speaks about you.
                </div>
              </div>
              <div className="settings-field">
                <label>Background</label>
                <textarea rows={3} value={profile.aboutMe} onChange={e => setProfile(p => ({ ...p, aboutMe: e.target.value }))} placeholder="Your role, how you work, what you focus on." />
              </div>
              {hadInstructions && (
                <div className="settings-field">
                  <label>Standing orders (old)</label>
                  <textarea rows={3} value={profile.instructions} onChange={e => setProfile(p => ({ ...p, instructions: e.target.value }))} />
                  <div style={{ fontSize: 11, color: 'var(--n-666666)', marginTop: 4 }}>
                    New standing instructions go in My Rules. Empty this box once they are there.
                  </div>
                </div>
              )}
              <button className="settings-btn" onClick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </section>

            <DisplaySection
              fontScale={fontScale}
              setFontScale={setFontScale}
              isOverride={fontScaleIsOverride}
              resetToDefault={resetFontScaleToDefault}
            />
          </>
        )}

        {tab === 'assistant' && (
          <>
            <AssistantSection />
            <BrainChannelSection user={user} />
            <MeetingAssistantSection />
            <BrainResetSection />
          </>
        )}

        {tab === 'openItems' && (
          <OpenItemsSection isSuperAdmin={!!user?.isSuperAdmin} clientNumber={user?.clientNumber} />
        )}

        {tab === 'suzi' && <SuziDesktopSection />}

        {tab === 'security' && (
          <>
            <section className="settings-section">
              <h2>Change Password</h2>
              <div className="settings-field">
                <label>Current Password</label>
                <input type="password" value={passwords.currentPassword} onChange={e => setPasswords(p => ({ ...p, currentPassword: e.target.value }))} autoComplete="current-password" />
              </div>
              <div className="settings-field">
                <label>New Password</label>
                <input type="password" value={passwords.newPassword} onChange={e => setPasswords(p => ({ ...p, newPassword: e.target.value }))} autoComplete="new-password" />
              </div>
              <button className="settings-btn" onClick={changePassword} disabled={saving}>{saving ? 'Changing…' : 'Change Password'}</button>
            </section>

            <section className="settings-section">
              <h2>Sign out</h2>
              <p style={{ fontSize: 12, color: 'var(--n-666666)', marginTop: -4, marginBottom: 10 }}>
                End this session on this device.
              </p>
              <button className="settings-btn danger" onClick={handleLogout}>Sign Out</button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}


/**
 * BrainChannelSection — how Brain reaches you between Day Briefs.
 *
 * Brain is autonomous: it watches feeds, processes them, and most of the time
 * acts without interrupting you. But when it's uncertain about a mid-day
 * decision, it messages you on the channel configured here. WhatsApp is the
 * default (and usually best) choice for Abdul.
 */
/**
 * T56 (founder 27 Nov): "Move Email Signature, Assistant settings to Nexeo and remove from both Suzi (Mob and
 * Laptop)". One place for her name, what she calls you, wake and sleep phrases and the email signature. Every Suzi
 * of yours (laptop, phone) reads them from Nexeo. A phrase left empty: Suzi keeps her own.
 */
function AssistantSection() {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.get('/profile/assistant').then((r) => {
      const d = r.data || {};
      setF({
        name: d.name || 'Suzi', user_name: d.user_name || '', wake_phrase: d.wake_phrase || '',
        sleep_phrases: (d.sleep_phrases || []).join(', '), signature: d.signature || '',
      });
    }).catch(() => setF(null));
  }, []);

  const save = async () => {
    setSaving(true); setMsg(''); setErr(false);
    try {
      const r = await api.put('/profile/assistant', f);
      const d = r.data || {};
      setF({ name: d.name, user_name: d.user_name, wake_phrase: d.wake_phrase || '', sleep_phrases: (d.sleep_phrases || []).join(', '), signature: d.signature || '' });
      setMsg('Saved. Suzi on your laptop and phone picks it up on her next update.');
    } catch (e) {
      setErr(true);
      setMsg(e?.response?.data?.error || 'Failed to save');
    }
    setSaving(false);
  };

  if (!f) return null;
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <section className="settings-section">
      <h2>Assistant</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="settings-field">
          <label>Her name</label>
          <input value={f.name} onChange={set('name')} maxLength={40} />
        </div>
        <div className="settings-field">
          <label>What she calls you</label>
          <input value={f.user_name} onChange={set('user_name')} maxLength={40} placeholder="e.g. Basit, Sir" />
        </div>
        <div className="settings-field">
          <label>Wake phrase</label>
          <input value={f.wake_phrase} onChange={set('wake_phrase')} maxLength={40} placeholder="hey sue zee" />
          <div style={{ fontSize: 11, color: 'var(--n-666666)', marginTop: 4 }}>Written the way it sounds.</div>
        </div>
        <div className="settings-field">
          <label>Sleep phrases</label>
          <input value={f.sleep_phrases} onChange={set('sleep_phrases')} placeholder="thank you suzi, that is all" />
          <div style={{ fontSize: 11, color: 'var(--n-666666)', marginTop: 4 }}>Said to end a conversation. Comma-separated.</div>
        </div>
      </div>
      <div className="settings-field">
        <label>Email signature</label>
        <textarea rows={4} value={f.signature} onChange={set('signature')} maxLength={500} placeholder={'Regards,\nYour name\nTitle | Company'} />
        <div style={{ fontSize: 11, color: 'var(--n-666666)', marginTop: 4 }}>
          The only signature on every email Nexeo or Suzi sends for you. Empty: no signature.
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="settings-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        {msg && <span style={{ fontSize: 12, color: err ? 'var(--s-fca5a5)' : 'var(--s-4ade80)' }}>{msg}</span>}
      </div>
    </section>
  );
}

function BrainChannelSection({ user }) {
  // Rewritten 2026-05-18 per user UX call:
  //   - Channel dropdown dropped (only WhatsApp; one-line note instead).
  //   - WhatsApp number defaults to registered contact number; only
  //     persists an override if the user explicitly enters one.
  //   - Numeric "Minimum confidence" replaced by a 3-mode boldness
  //     selector (cautious / balanced / eager). Backend derives the
  //     threshold for existing consumers.
  //   - Daily message cap dropped from UI (still a hard ceiling in code).
  //   - Trust statement moved to the top of the section.
  //   - "Send test ping" button verifies the channel without enabling
  //     the autonomous opt-in.
  //   - Brain naming (was on Profile) moved here as the first block.
  const [registeredNumber, setRegisteredNumber] = useState('');
  const [whatsappNumberOverride, setWhatsappNumberOverride] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('06:00');
  const [outboundEnabled, setOutboundEnabled] = useState(false);
  const [outboundPaused, setOutboundPaused] = useState(false);
  const [dayBriefTime, setDayBriefTime] = useState('08:30');
  const [timezone, setTimezone] = useState('Asia/Karachi');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [pingMsg, setPingMsg] = useState('');
  const [pinging, setPinging] = useState(false);
  const [briefMsg, setBriefMsg] = useState('');
  const [briefMsgKind, setBriefMsgKind] = useState('info'); // 'ok' | 'err' | 'info'
  const [briefPreview, setBriefPreview] = useState('');
  const [sendingBrief, setSendingBrief] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    api.get(`/profile/brain-channel`).then((r) => {
      const d = r.data || {};
      setRegisteredNumber(d.registeredContactNumber || user?.contactNumber || '');
      setWhatsappNumberOverride(d.whatsappNumber || '');
      setOverrideOpen(!!d.whatsappNumber);
      setQuietStart(d.quietStart || '22:00');
      setQuietEnd(d.quietEnd || '06:00');
      setOutboundEnabled(d.outboundEnabled === true);
      setOutboundPaused(!!d.outboundPaused);
      setDayBriefTime(d.dayBriefTime || '08:30');
      setTimezone(d.timezone || 'Asia/Karachi');
    }).catch(() => {
      setRegisteredNumber(user?.contactNumber || '');
    });
  }, [user?.id]);

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      await api.put('/profile/brain-channel', {
        whatsappNumber: overrideOpen ? whatsappNumberOverride : '',
        quietStart, quietEnd,
        outboundEnabled,
        outboundPaused,
        dayBriefTime,
        timezone,
      });
      setMsg('Saved');
      setTimeout(() => setMsg(''), 2000);
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Failed to save');
    }
    setSaving(false);
  };

  const sendTestPing = async () => {
    setPinging(true); setPingMsg('');
    try {
      await api.post('/profile/test-ping');
      setPingMsg('Sent — check your WhatsApp.');
      setTimeout(() => setPingMsg(''), 4000);
    } catch (err) {
      const reason = err?.response?.data?.reason || err?.response?.data?.error || 'send failed';
      setPingMsg(`Test ping failed: ${reason}`);
      setTimeout(() => setPingMsg(''), 6000);
    }
    setPinging(false);
  };

  const sendDayBriefNow = async () => {
    setSendingBrief(true); setBriefMsg(''); setBriefPreview('');
    try {
      const r = await api.post('/profile/day-brief/send-now');
      setBriefMsg('Sent — check your WhatsApp. Same content below.');
      setBriefMsgKind('ok');
      setBriefPreview(r?.data?.preview || '');
    } catch (err) {
      const reason = err?.response?.data?.reason || err?.response?.data?.error || 'send failed';
      // If dispatch failed but the composer still returned content, show it
      // so the user can verify what Brain *would* have sent and fix the
      // failure cause (most often: notifier_not_paired).
      const preview = err?.response?.data?.preview || '';
      setBriefMsg(`Send failed: ${reason}${preview ? ' — preview below.' : ''}`);
      setBriefMsgKind('err');
      setBriefPreview(preview);
    }
    setSendingBrief(false);
  };

  const pingTarget = overrideOpen && whatsappNumberOverride ? whatsappNumberOverride : registeredNumber;

  return (
    <>
      <section className="settings-section">
        <h2>Notifications</h2>
        <p style={{ color: 'var(--n-888888)', fontSize: 13, marginTop: -4, marginBottom: 12 }}>
          Nexeo reaches you on WhatsApp from the company number. It never sends from your own number.
        </p>

        {msg && <div className="settings-msg" style={{ marginBottom: 10 }}>{msg}</div>}

        <div className="settings-field">
          <label>WhatsApp number</label>
          {!overrideOpen ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--n-1f1f1f)', border: '1px solid var(--n-333333)', borderRadius: 8 }}>
              <span style={{ flex: 1, color: 'var(--n-eeeeee)', fontSize: 13 }}>
                Pinging on <strong>{registeredNumber || '(no number on file)'}</strong> <span style={{ color: 'var(--n-666666)' }}>(your registered contact number)</span>
              </span>
              <button type="button" onClick={() => setOverrideOpen(true)}
                style={{ background: 'transparent', border: '1px solid var(--n-444444)', color: 'var(--n-cccccc)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                Use different number
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                value={whatsappNumberOverride}
                onChange={(e) => setWhatsappNumberOverride(e.target.value)}
                placeholder={registeredNumber || '+92 300 1234567'}
                style={{ flex: 1 }}
              />
              <button type="button" onClick={() => { setOverrideOpen(false); setWhatsappNumberOverride(''); }}
                style={{ background: 'transparent', border: '1px solid var(--n-444444)', color: 'var(--n-cccccc)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>
                Use registered
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="settings-field">
            <label>Quiet hours start <span style={{ color: 'var(--n-666666)', fontWeight: 400 }}>(your timezone)</span></label>
            <input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />
          </div>
          <div className="settings-field">
            <label>Quiet hours end</label>
            <input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
          </div>
        </div>

        {/* Day Brief delivery — schedule, timezone, and on-demand send/preview.
            Grouped into its own block so the "send now / preview" affordance
            sits next to the schedule it's previewing, not buried under a
            shared row with quiet hours. */}
        <div style={{
          marginTop: 8, padding: 14,
          border: '1px solid var(--n-2f2f2f)', borderRadius: 10, background: 'var(--n-1a1a1a)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n-eeeeee)', letterSpacing: 0.3, textTransform: 'uppercase' }}>
              Day Brief delivery
            </div>
            <div style={{ fontSize: 11, color: 'var(--n-666666)' }}>via WhatsApp · bypasses quiet hours</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="settings-field">
              <label>Scheduled time</label>
              <input type="time" value={dayBriefTime} onChange={(e) => setDayBriefTime(e.target.value)} />
            </div>
            <div className="settings-field">
              <label>Timezone</label>
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
                      style={{ width: '100%', padding: 8, background: 'var(--n-2a2a2a)', border: '1px solid var(--n-444444)', color: 'var(--n-eeeeee)', borderRadius: 8, fontSize: 13 }}>
                <option value="Asia/Karachi">Asia/Karachi (PKT, UTC+5)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST, UTC+4)</option>
                <option value="Asia/Riyadh">Asia/Riyadh (AST, UTC+3)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="America/New_York">America/New_York (ET)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PT)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>

          {/* On-demand send. Primary-styled button so it reads as a real
              feature, not a secondary chip. After click, the composed body
              is shown inline so the user can see what Brain sent (or would
              have sent, if the notifier isn't paired yet). */}
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" onClick={sendDayBriefNow} disabled={sendingBrief || !pingTarget}
              style={{
                background: pingTarget ? '#e94560' : 'var(--t-4a2730)',
                border: 'none', color: '#fff',
                borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 600,
                cursor: pingTarget && !sendingBrief ? 'pointer' : 'not-allowed',
                opacity: sendingBrief ? 0.7 : 1,
              }}>
              {sendingBrief ? 'Composing & sending…' : 'Send Day Brief to my WhatsApp now'}
            </button>
            {!pingTarget && (
              <span style={{ fontSize: 11, color: 'var(--n-888888)' }}>
                Add a WhatsApp number above first.
              </span>
            )}
            {briefMsg && (
              <span style={{
                fontSize: 12,
                color: briefMsgKind === 'ok' ? 'var(--s-4ade80)' : briefMsgKind === 'err' ? 'var(--s-fca5a5)' : 'var(--n-aaaaaa)',
              }}>{briefMsg}</span>
            )}
          </div>

          <div style={{ fontSize: 11, color: 'var(--n-666666)', marginTop: 8 }}>
            Sends today's Day Brief now, the same one sent at {dayBriefTime || '08:30'}.
          </div>

          {/* Inline preview of the composed body. Renders below the button
              so the user sees Brain's actual output without checking WA —
              especially useful before the notifier is paired (sent=false
              still returns preview content). */}
          {briefPreview && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--n-888888)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  Preview
                </div>
                <button type="button" onClick={() => { setBriefPreview(''); setBriefMsg(''); }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--n-888888)', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                  Hide
                </button>
              </div>
              <pre style={{
                margin: 0, padding: 12, background: 'var(--n-0f0f0f)', border: '1px solid var(--n-2a2a2a)',
                borderRadius: 8, color: 'var(--n-dddddd)', fontSize: 12.5, lineHeight: 1.55,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit',
                maxHeight: 360, overflowY: 'auto',
              }}>{briefPreview}</pre>
            </div>
          )}
        </div>

        <h3 style={{ fontSize: 13, color: 'var(--n-aaaaaa)', marginTop: 18, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px' }}>
          Messages during the day
        </h3>

        <div className="settings-field" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: outboundEnabled ? 'rgba(34,197,94,0.10)' : 'var(--n-1f1f1f)', border: `1px solid ${outboundEnabled ? 'rgba(34,197,94,0.5)' : 'var(--n-444444)'}`, borderRadius: 8 }}>
          <input type="checkbox" id="outboundEnabled" checked={outboundEnabled} onChange={(e) => setOutboundEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
          <label htmlFor="outboundEnabled" style={{ flex: 1, cursor: 'pointer', margin: 0 }}>
            <div style={{ color: outboundEnabled ? 'var(--s-86efac)' : 'var(--n-eeeeee)', fontWeight: 600 }}>
              Message me on WhatsApp when something needs me
            </div>
            <div style={{ fontSize: 11, color: 'var(--n-888888)', marginTop: 2 }}>
              Off: everything waits for the Day Brief.
            </div>
          </label>
        </div>

        <div className="settings-field" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: outboundPaused ? 'rgba(239,68,68,0.10)' : 'var(--n-1f1f1f)', border: `1px solid ${outboundPaused ? 'rgba(239,68,68,0.5)' : 'var(--n-333333)'}`, borderRadius: 8, marginTop: 8 }}>
          <input type="checkbox" id="outboundPaused" checked={outboundPaused} onChange={(e) => setOutboundPaused(e.target.checked)} style={{ width: 18, height: 18 }} />
          <label htmlFor="outboundPaused" style={{ flex: 1, cursor: 'pointer', margin: 0 }}>
            <div style={{ color: outboundPaused ? 'var(--s-fca5a5)' : 'var(--n-eeeeee)', fontWeight: 600 }}>
              {outboundPaused ? 'Paused: no messages' : 'Pause all messages'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--n-888888)', marginTop: 2 }}>
              Stops every message until you turn it off.
            </div>
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
          <button className="settings-btn" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={sendTestPing} disabled={pinging || !pingTarget}
            style={{
              background: 'transparent', border: '1px solid var(--n-444444)', color: 'var(--n-cccccc)',
              borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: pingTarget ? 'pointer' : 'not-allowed',
            }}>
            {pinging ? 'Sending…' : 'Send test ping'}
          </button>
          {pingMsg && <span style={{ fontSize: 12, color: pingMsg.startsWith('Sent') ? 'var(--s-4ade80)' : 'var(--s-fca5a5)' }}>{pingMsg}</span>}
        </div>
      </section>
    </>
  );
}

const FONT_PRESETS = [
  { label: 'Small', value: 0.9 },
  { label: 'Normal', value: 1.0 },
  { label: 'Large', value: 1.15 },
  { label: 'XL', value: 1.3 },
];

const THEME_OPTIONS = [
  { label: 'Dark', value: 'dark' },
  { label: 'Light', value: 'light' },
  { label: 'Match system', value: 'system' },
];

function fontPresetButtonStyle(active) {
  return active
    ? {
        // Strong contrast — never match label to background.
        background: 'var(--bg-1)',
        color: 'var(--accent)',
        borderColor: 'var(--accent)',
        borderWidth: 2,
        fontWeight: 700,
      }
    : undefined;
}

/** Theme and text size, for this user. */
function DisplaySection({ fontScale, setFontScale, isOverride, resetToDefault }) {
  const current = Number(fontScale ?? 1);
  const { preference: themePref, setPreference: setThemePref } = useTheme();

  return (
    <section className="settings-section">
      <h2>Display</h2>

      <div className="settings-field">
        <label>Theme</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.value}
              className="settings-btn"
              role="radio"
              aria-checked={themePref === o.value}
              onClick={() => setThemePref(o.value)}
              style={fontPresetButtonStyle(themePref === o.value)}
            >{o.label}</button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          Saved on this browser. Match system follows your computer's light or dark setting.
        </div>
      </div>

      <div className="settings-field">
        <label>Text size</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {FONT_PRESETS.map((p) => (
            <button
              key={p.value}
              className="settings-btn"
              onClick={() => setFontScale(p.value)}
              style={fontPresetButtonStyle(Math.abs(current - p.value) < 0.02)}
            >{p.label}</button>
          ))}
          {isOverride && (
            <>
              <span style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />
              <button className="settings-btn" onClick={resetToDefault}>
                Reset
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * OpenItemsSection — knobs for the open-items lifecycle.
 *
 * Three groups: lifecycle (follow-up cadence, archive, stale, DRAFT
 * expiry), auto-creation gating (which sources Brain may auto-create
 * from + the criticality floor), and purge (destructive — typed-phrase
 * confirmation per the no-browser-dialogs rule).
 *
 * What's NOT here on purpose: anything that asks the user to predict
 * a specific day or threshold. Brain decides "send today vs tomorrow";
 * the user decides "how often, max attempts, what's a stale item".
 */
function OpenItemsSection({ isSuperAdmin = false, clientNumber = '' }) {
  const [s, setS] = useState({
    followUpDays: 3,
    autoArchiveClosedAfterDays: 30,
    staleThresholdDays: 14,
    draftExpiryDays: 6,
    draftAskChannel: 'whatsapp',
    autoCreateFromEmail: true,
    autoCreateFromWhatsapp: true,
    autoCreateFromVoice: true,
    autoCreateCriticalityFloor: 'all',
    defaultSort: 'priority',
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/profile/open-items')
      .then((r) => setS((prev) => ({ ...prev, ...r.data })))
      .catch(() => {});
  }, []);

  const set = (k, v) => setS((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      await api.put('/profile/open-items', s);
      setMsg('Saved');
      setTimeout(() => setMsg(''), 2000);
    } catch {
      setMsg('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="settings-section">
        <h2>Open items</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="settings-field">
            <label>Follow up delegated items every (days)</label>
            <input type="number" min="1" max="30" value={s.followUpDays}
                   onChange={(e) => set('followUpDays', parseInt(e.target.value, 10) || 3)} />
          </div>

          <div className="settings-field">
            <label>Ask "still alive?" after quiet days (0 = never)</label>
            <input type="number" min="0" max="90" value={s.staleThresholdDays}
                   onChange={(e) => set('staleThresholdDays', parseInt(e.target.value, 10) || 0)} />
          </div>
        </div>

        <div style={{ fontSize: 13, marginTop: 14, marginBottom: 4 }}>Create items from</div>
        <div style={{ fontSize: 11, color: 'var(--n-666666)', marginBottom: 6 }}>
          Off: found items wait in the Day Brief for your yes instead.
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
          <input type="checkbox" checked={s.autoCreateFromEmail}
                 onChange={(e) => set('autoCreateFromEmail', e.target.checked)} />
          <span>Email</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
          <input type="checkbox" checked={s.autoCreateFromWhatsapp}
                 onChange={(e) => set('autoCreateFromWhatsapp', e.target.checked)} />
          <span>WhatsApp</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
          <input type="checkbox" checked={s.autoCreateFromVoice}
                 onChange={(e) => set('autoCreateFromVoice', e.target.checked)} />
          <span>Voice notes</span>
        </label>

        <div className="settings-field" style={{ marginTop: 14 }}>
          <label>Only items at least this important</label>
          <select value={s.autoCreateCriticalityFloor} onChange={(e) => set('autoCreateCriticalityFloor', e.target.value)}
                  style={{ width: '100%', padding: 8, background: 'var(--n-2a2a2a)', border: '1px solid var(--n-444444)', color: 'var(--n-eeeeee)', borderRadius: 8, fontSize: 13 }}>
            <option value="all">All</option>
            <option value="medium">Medium and above</option>
            <option value="high">High and critical only</option>
          </select>
        </div>
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <button className="settings-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        {msg && <span style={{ fontSize: 12, color: msg === 'Saved' ? 'var(--s-4ade80)' : 'var(--s-f87171)' }}>{msg}</span>}
      </div>

      <PurgePanel isSuperAdmin={isSuperAdmin} clientNumber={clientNumber} />
    </>
  );
}

/**
 * PurgePanel — destructive cleanup with typed-phrase confirmation.
 *
 * Two-step: (1) user picks scope (closed / stale / expired-draft) and
 * hits Preview → server returns the count + the exact phrase the user
 * must type. (2) user types the phrase + hits Purge → server validates
 * both the phrase AND that the count still matches (so new items
 * arriving between preview and confirm can't get silently swept).
 *
 * No browser dialogs ([[feedback_no_browser_dialogs]]).
 */
function PurgePanel({ isSuperAdmin = false, clientNumber = '' }) {
  // Scope shape: three "dead-item" toggles + one "all" nuclear flag
  // + (SA only) tenantWide flag. Default scope is the requester's
  // own items. SA users can toggle tenantWide=true to operate across
  // the whole tenant — server-side the confirmation phrase grows the
  // " ACROSS TENANT" suffix so keystrokes match consequence.
  const [scope, setScope] = useState({ closed: false, stale: false, expiredDraft: false, all: false, tenantWide: false });
  const [preview, setPreview] = useState(null);
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState('');

  const togglesEmpty = !scope.closed && !scope.stale && !scope.expiredDraft && !scope.all;
  // Nuclear locks out the dead-item toggles — wiping "everything"
  // includes them anyway, no point letting the user double-pick.
  const deadDisabled = scope.all;

  const flipDead = (k, v) => {
    setScope((s) => ({ ...s, [k]: v }));
    setPreview(null); setTyped('');
  };
  const flipNuclear = (v) => {
    setScope((s) => v
      ? { closed: false, stale: false, expiredDraft: false, all: true }
      : { ...s, all: false });
    setPreview(null); setTyped('');
  };
  const selectAllDead = () => {
    setScope({ closed: true, stale: true, expiredDraft: true, all: false });
    setPreview(null); setTyped('');
  };

  const runPreview = async () => {
    setWorking(true); setMsg(''); setPreview(null); setTyped('');
    try {
      const r = await api.post('/profile/open-items/purge/preview', { scope });
      setPreview(r.data);
      if (r.data.count === 0) setMsg('Nothing matches the selected scope.');
    } catch (e) {
      setMsg('Preview failed.');
    } finally {
      setWorking(false);
    }
  };

  const runPurge = async () => {
    if (!preview || preview.count === 0) return;
    setWorking(true); setMsg('');
    try {
      const r = await api.post('/profile/open-items/purge', { scope, phrase: typed });
      setMsg(`Purged ${r.data.deleted} item${r.data.deleted === 1 ? '' : 's'}${r.data.tenantWide ? ' across the tenant' : ''}.`);
      setPreview(null); setTyped('');
      setScope({ closed: false, stale: false, expiredDraft: false, all: false, tenantWide: false });
    } catch (e) {
      if (e.response?.status === 409) {
        setMsg(`Count changed — phrase should now be "${e.response.data.expectedPhrase}". Re-preview to confirm.`);
        setPreview(e.response.data ? { count: e.response.data.count, phrase: e.response.data.expectedPhrase } : null);
      } else {
        setMsg('Purge failed.');
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="settings-section" style={{ marginTop: 16, borderLeft: '3px solid var(--s-dc2626)', paddingLeft: 12 }}>
      <h2 style={{ color: 'var(--s-fca5a5)' }}>Purge data — destructive</h2>
      <p style={{ fontSize: 12, color: 'var(--n-888888)', marginTop: -6, marginBottom: 14 }}>
        Hard-deletes the selected open items. Cannot be undone. Pick a scope, hit
        Preview to see the count, then type the confirmation phrase exactly to fire.
      </p>

      {/* SA-only tenant-wide toggle. Default OFF — must be explicit.
          When on, every where-clause swaps from {userId: me} to
          {clientNumber: my_tenant} and the confirmation phrase gets
          " ACROSS TENANT" appended server-side so the keystrokes
          reflect the consequence. */}
      {isSuperAdmin && (
        <div style={{
          marginBottom: 14, padding: 10, borderRadius: 8,
          background: scope.tenantWide ? 'rgba(204,107,74,0.15)' : 'rgba(204,107,74,0.05)',
          border: `1px solid ${scope.tenantWide ? 'rgba(204,107,74,0.6)' : 'rgba(204,107,74,0.3)'}`,
        }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <input type="checkbox" checked={scope.tenantWide}
                   onChange={(e) => { setScope({ ...scope, tenantWide: e.target.checked }); setPreview(null); setTyped(''); }}
                   style={{ marginTop: 2 }} />
            <div>
              <div style={{ color: scope.tenantWide ? 'var(--s-fbbf24)' : 'var(--n-eeeeee)', fontWeight: 600 }}>
                Across the entire tenant ({clientNumber || 'this tenant'}) — SA only
              </div>
              <div style={{ fontSize: 11, color: 'var(--n-888888)', marginTop: 2 }}>
                Off: operate only on items you personally own. On: operate on
                every user's items in this tenant. Use this to clean up data
                created by other users or by background pollers.
              </div>
            </div>
          </label>
        </div>
      )}

      {/* Dead-item scopes — safe individually, safe combined */}
      <div style={{ marginBottom: 14, opacity: deadDisabled ? 0.4 : 1 }}>
        <div style={{ fontSize: 12, color: 'var(--n-aaaaaa)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>
          Dead items
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
          <input type="checkbox" checked={scope.closed} disabled={deadDisabled}
                 onChange={(e) => flipDead('closed', e.target.checked)} />
          <span>All closed items</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
          <input type="checkbox" checked={scope.expiredDraft} disabled={deadDisabled}
                 onChange={(e) => flipDead('expiredDraft', e.target.checked)} />
          <span>Expired DRAFT items only</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
          <input type="checkbox" checked={scope.stale} disabled={deadDisabled}
                 onChange={(e) => flipDead('stale', e.target.checked)} />
          <span>Items marked stale</span>
        </label>
        <button type="button" onClick={selectAllDead} disabled={deadDisabled}
          style={{
            marginTop: 4, padding: '4px 10px', fontSize: 12,
            background: 'transparent', border: '1px solid var(--n-444444)', color: 'var(--n-cccccc)',
            borderRadius: 6, cursor: deadDisabled ? 'not-allowed' : 'pointer',
          }}>
          Select all dead
        </button>
      </div>

      {/* Nuclear — fenced off visually and by a stronger phrase server-side */}
      <div style={{
        marginBottom: 14, padding: 10, borderRadius: 8,
        background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.4)',
      }}>
        <div style={{ fontSize: 12, color: 'var(--s-fca5a5)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>
          Nuclear reset
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '4px 0' }}>
          <input type="checkbox" checked={scope.all}
                 onChange={(e) => flipNuclear(e.target.checked)}
                 style={{ marginTop: 2 }} />
          <div>
            <div style={{ color: 'var(--s-fecaca)', fontWeight: 600 }}>
              Everything — including active items
            </div>
            <div style={{ fontSize: 11, color: 'var(--s-fca5a5)', marginTop: 2 }}>
              ⚠ Deletes every open item for you, regardless of status.
              Active delegations Brain is currently chasing, DRAFT items
              awaiting your priority, NEW items not yet triaged — all gone.
              Use this for a clean reset, not routine cleanup.
            </div>
          </div>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="settings-btn" onClick={runPreview} disabled={working || togglesEmpty}>
          {working ? 'Working…' : 'Preview'}
        </button>

        {preview && preview.count > 0 && (
          <>
            <div style={{ fontSize: 13, color: 'var(--s-fca5a5)' }}>
              {preview.count} item{preview.count === 1 ? '' : 's'} will be deleted. Type{' '}
              <code style={{ background: 'var(--n-2a2a2a)', padding: '2px 6px', borderRadius: 4 }}>{preview.phrase}</code>{' '}
              to confirm.
            </div>
            <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)}
                   placeholder={preview.phrase}
                   style={{ flex: '1 1 240px', minWidth: 200, padding: 8, background: 'var(--n-2a2a2a)', border: '1px solid var(--s-dc2626)', color: 'var(--n-eeeeee)', borderRadius: 8, fontSize: 13, fontFamily: 'monospace' }} />
            <button className="settings-btn danger" onClick={runPurge}
                    disabled={working || typed !== preview.phrase}>
              {working ? 'Purging…' : 'Purge'}
            </button>
          </>
        )}
      </div>

      {msg && <div style={{ fontSize: 12, color: msg.startsWith('Purged') ? 'var(--s-4ade80)' : 'var(--s-fca5a5)', marginTop: 10 }}>{msg}</div>}
    </section>
  );
}

/**
 * BrainResetSection — Settings → Brain → Reset & Cleanup.
 *
 * Per Basit 2026-05-23: user controls own data lifecycle, no dev
 * dependency for future wipes. Three tiers with typed-phrase
 * confirmation (per no-browser-dialogs rule).
 */
// F-4.2 (agreed 12 Nov 2026): his own Meeting Assistant switch, off by default.
function MeetingAssistantSection() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.get('/profile/meeting-assistant').then((r) => setState(r.data)).catch(() => setState(null)); }, []);

  async function toggle(enabled) {
    setBusy(true); setMsg('');
    try {
      const r = await api.put('/profile/meeting-assistant', { enabled });
      setState(r.data);
      setMsg(enabled ? 'Meeting Assistant is on.' : 'Meeting Assistant is off. Your existing meeting records are kept; you can delete them yourself.');
    } catch (e) {
      setMsg(e?.response?.data?.error ?? 'Could not change the setting');
    } finally { setBusy(false); }
  }

  async function reconnect() {
    setBusy(true); setMsg('');
    try {
      const list = await api.get('/connectors/available');
      const google = (list.data?.connectors ?? []).find((c) => c.slug === 'google_calendar') ?? (list.data?.connectors ?? []).find((c) => c.slug === 'gmail');
      if (!google) { setMsg('No Google connector found. Open Connectors to connect Google.'); setBusy(false); return; }
      const r = await api.post('/connectors/oauth/url', { connectorTypeId: google.id });
      if (r.data?.url) window.location.href = r.data.url;
      else { setMsg(r.data?.error ?? 'Could not start Google sign-in'); setBusy(false); }
    } catch (e) { setMsg(e?.response?.data?.error ?? 'Could not start Google sign-in'); setBusy(false); }
  }

  if (!state) return null;
  return (
    <section className="settings-section" style={{ marginTop: 20 }}>
      <h2>Meeting Assistant</h2>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: busy ? 'wait' : 'pointer' }}>
        <input type="checkbox" checked={state.enabled} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        <span style={{ fontSize: 14 }}>{state.enabled ? 'On' : 'Off'}</span>
      </label>
      <p style={{ fontSize: 12, color: 'var(--n-999999)', marginTop: 6 }}>
        Google Meet meetings you host: after the meeting Nexeo reads Google's transcript and writes the minutes and proposed action items. Only you see them. Turning it off stops this; records already made are kept until you delete them.
      </p>
      {state.enabled && state.needs_reconnect && (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid var(--s-fbbf24)', fontSize: 13 }}>
          Reconnect Google to allow Meet. Until then no meeting is read.
          <button style={{ marginLeft: 10 }} disabled={busy} onClick={reconnect}>Reconnect Google</button>
        </div>
      )}
      {msg && <div style={{ fontSize: 12, marginTop: 6 }}>{msg}</div>}
    </section>
  );
}

function BrainResetSection() {
  const [tier, setTier] = React.useState('refresh');
  const [counts, setCounts] = React.useState(null);
  const [typed, setTyped] = React.useState('');
  const [working, setWorking] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [history, setHistory] = React.useState([]);

  const TIER_PHRASES = { quick: 'QUICK RESET', refresh: 'BRAIN REFRESH', full: 'BRAIN RESET' };
  const expectedPhrase = TIER_PHRASES[tier];

  React.useEffect(() => {
    api.get('/brain/reset/preview').then((r) => setCounts(r.data)).catch(() => setCounts(null));
    api.get('/brain/reset/history').then((r) => setHistory(r.data?.resets ?? [])).catch(() => setHistory([]));
  }, []);

  const tierDescriptions = {
    quick:   { label: 'Quick reset',  blurb: 'Clears stuck confirmations. Nothing else changes.' },
    refresh: { label: 'Refresh',      blurb: 'Clears working memory, then re-reads your last 30 days of email and calendar. Takes a few minutes. Your open items and contacts stay.' },
    full:    { label: 'Full reset',   blurb: 'Everything in Refresh, and also deletes ALL your open items and contacts. Your account and connections stay.' },
  };

  function wipedForTier(t) {
    if (!counts) return null;
    const c = counts.counts;
    if (t === 'quick') return { brain_pending_actions: c.brain_pending_actions };
    if (t === 'refresh') {
      return {
        brain_pending_actions: c.brain_pending_actions,
        clarification_memory: c.clarification_memory,
        reasoning_traces: c.reasoning_traces,
        brain_action_artifacts: c.brain_action_artifacts,
      };
    }
    if (t === 'full') {
      return {
        brain_pending_actions: c.brain_pending_actions,
        clarification_memory: c.clarification_memory,
        reasoning_traces: c.reasoning_traces,
        brain_action_artifacts: c.brain_action_artifacts,
        open_items: c.full_only_open_items,
        contact_entities: c.full_only_contact_entities,
        contact_wiki_pages: c.full_only_contact_wiki_pages,
      };
    }
    return null;
  }

  async function runReset() {
    if (typed !== expectedPhrase) {
      setMsg(`Type "${expectedPhrase}" exactly to confirm`);
      return;
    }
    setWorking(true);
    setMsg('');
    try {
      const r = await api.post('/brain/reset', { tier, confirmation: typed });
      const wiped = r.data?.wipedCounts ?? {};
      const total = Object.values(wiped).reduce((a, b) => a + Number(b || 0), 0);
      setMsg(`Reset complete. ${total} row${total === 1 ? '' : 's'} wiped. Archives kept for 7 days.${r.data?.refeed === 'started' ? ' Brain is now re-reading your last 30 days and rebuilding its memory of your people; this takes a few minutes.' : ''}`);
      setTyped('');
      // refresh counts + history
      const preview = await api.get('/brain/reset/preview').catch(() => null);
      if (preview) setCounts(preview.data);
      const hist = await api.get('/brain/reset/history').catch(() => null);
      if (hist) setHistory(hist.data?.resets ?? []);
    } catch (e) {
      setMsg(`Reset failed: ${e?.response?.data?.error ?? e?.message ?? 'unknown'}`);
    } finally {
      setWorking(false);
    }
  }

  const wipeMap = wipedForTier(tier);
  return (
    <section className="settings-section" style={{ marginTop: 20 }}>
      <h2>Reset</h2>
      <p style={{ fontSize: 13, color: 'var(--n-aaaaaa)', marginTop: -6 }}>
        Use when Nexeo seems confused. Kept for 7 days so support can restore it.
      </p>

      <div style={{ marginTop: 12 }}>
        {Object.keys(tierDescriptions).map((t) => (
          <label key={t} style={{ display: 'block', padding: 8, marginBottom: 4, background: tier === t ? 'var(--n-2a2a2a)' : 'transparent', borderRadius: 6, cursor: 'pointer', border: tier === t ? '1px solid var(--s-cc6b4a)' : '1px solid transparent' }}>
            <input
              type="radio"
              name="reset-tier"
              checked={tier === t}
              onChange={() => { setTier(t); setTyped(''); setMsg(''); }}
              style={{ marginRight: 8 }}
            />
            <strong>{tierDescriptions[t].label}</strong>
            <div style={{ fontSize: 12, color: 'var(--n-999999)', marginLeft: 24, marginTop: 4 }}>{tierDescriptions[t].blurb}</div>
          </label>
        ))}
      </div>

      {wipeMap && (
        <div style={{ marginTop: 12, padding: 12, background: 'var(--n-1a1a1a)', borderRadius: 8, border: '1px solid var(--n-444444)' }}>
          <div style={{ fontSize: 13, color: 'var(--n-dddddd)', marginBottom: 6 }}><strong>What will be wiped:</strong></div>
          {Object.entries(wipeMap).map(([k, v]) => (
            <div key={k} style={{ fontSize: 12, color: v > 0 ? 'var(--s-fbbf24)' : 'var(--n-666666)' }}>
              {k.replace(/_/g, ' ')}: <strong>{v}</strong>
            </div>
          ))}
          <div style={{ fontSize: 12, color: 'var(--s-4ade80)', marginTop: 8 }}>
            Preserved: account + OAuth grants, stored feed events, FACL docs and non-contact pages, prompt blocks, action definitions{tier === 'full' ? '.' : ', your open items and your contacts.'}
            {tier !== 'quick' && (
              <div style={{ marginTop: 4, color: 'var(--n-dddddd)' }}>
                Then: re-reads your last 30 days of email and calendar (memory only, no new Action Center items) and rebuilds your people pages, in the background.
              </div>
            )}
            {tier === 'full' && (
              <div style={{ marginTop: 4, color: 'var(--s-fbbf24)' }}>
                ⚠️ Full Reset wipes your open items and contacts.
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--s-fca5a5)', marginBottom: 6 }}>
          Type <code style={{ background: 'var(--n-2a2a2a)', padding: '2px 6px', borderRadius: 4 }}>{expectedPhrase}</code> to confirm
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expectedPhrase}
            style={{ flex: '1 1 220px', minWidth: 200, padding: 8, background: 'var(--n-2a2a2a)', border: '1px solid var(--s-dc2626)', color: 'var(--n-eeeeee)', borderRadius: 8, fontFamily: 'monospace', fontSize: 13 }}
          />
          <button
            className="settings-btn danger"
            onClick={runReset}
            disabled={working || typed !== expectedPhrase}
          >
            {working ? 'Resetting…' : `Confirm ${tierDescriptions[tier].label}`}
          </button>
        </div>
      </div>

      {msg && (
        <div style={{ fontSize: 13, color: msg.startsWith('Reset complete') ? 'var(--s-4ade80)' : 'var(--s-fca5a5)', marginTop: 12 }}>
          {msg}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Recent resets</h3>
          {history.slice(0, 10).map((h) => (
            <div key={h.id} style={{ fontSize: 12, color: 'var(--n-999999)', padding: '4px 0', borderBottom: '1px solid var(--n-2a2a2a)' }}>
              <span style={{ color: 'var(--n-dddddd)' }}>{new Date(h.createdAt).toLocaleString()}</span>
              {' — '}
              <span style={{ color: 'var(--s-cc6b4a)' }}>{h.tier}</span>
              {' — '}
              {Object.entries(h.wipedCounts ?? {}).map(([k, v]) => `${k.replace(/_/g, ' ')}=${v}`).join(', ')}
              {h.archiveSuffix && <span style={{ color: 'var(--n-666666)', marginLeft: 8 }}>(archive {h.archiveSuffix})</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
