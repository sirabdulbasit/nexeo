// Suzi desktop (DEF-370) — give the Suzi desktop app the server URL + YOUR OWN API key (each Nexeo
// user gets a different key), valid for the period chosen here, and see / disconnect the
// computers using your keys. Lives in Settings → Suzi desktop.
import { useEffect, useState } from 'react';
import { InlineConfirm, formatPkt } from '../pages/admin/integrations/integrationUi';
import { createApiKey, disconnectDevice, errorText, installerLink, listDevices, listInstallers } from '../services/suziApi';

// Link T30: which installer fits this visitor's computer; both are always shown.
const THIS_OS = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? 'macos' : /Win/i.test(navigator.platform || navigator.userAgent) ? 'windows' : null;
const OS_NAME = { macos: 'Mac (.dmg)', windows: 'Windows (.exe)' };

const VALIDITY = [7, 30, 90, 'never'];

export default function SuziDesktopSection() {
  const [validity, setValidity] = useState(30);
  const [issued, setIssued] = useState(null); // { apiKey, keyPrefix, expiresAt, validityDays, serverUrl, connectLink }
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null); // 'url' | 'key' | 'both'
  const [msg, setMsg] = useState(null); // { ok, text }
  const [devices, setDevices] = useState(null);

  const load = () =>
    listDevices()
      .then(setDevices)
      .catch((e) => {
        setDevices([]);
        setMsg({ ok: false, text: errorText(e) });
      });

  useEffect(() => {
    load();
  }, []);

  const generate = async () => {
    setBusy(true);
    setMsg(null);
    setCopied(null);
    try {
      setIssued(await createApiKey(validity));
      await load();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (what, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setMsg({ ok: false, text: 'Clipboard blocked — select the text and copy it manually.' });
    }
  };

  const disconnect = async (d) => {
    setMsg(null);
    try {
      await disconnectDevice(d.id);
      if (issued && d.keyPrefix === issued.keyPrefix) setIssued(null);
      setMsg({ ok: true, text: `${label(d)} is disconnected — its key no longer works.` });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
    await load();
  };

  return (
    <>
      <DownloadSuzi />
      <section className="settings-section">
        <h2>Connect Suzi desktop</h2>
        <p style={{ fontSize: 12, color: '#666', marginTop: -4, marginBottom: 10 }}>
          Suzi is your voice assistant on your own Mac or Windows computer. Generate your API key here and enter it in the
          Suzi desktop app together with the server URL. The key is yours alone and works until it expires or you disconnect it.
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 13 }}>Valid for</span>
          {VALIDITY.map((d) => (
            <label key={d} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" name="suzi-validity" checked={validity === d} onChange={() => setValidity(d)} />
              {d === 'never' ? 'Never expires' : `${d} days`}
            </label>
          ))}
        </div>
        <button className="settings-btn" onClick={generate} disabled={busy}>
          {busy ? <><span className="btn-spinner" /> Generating…</> : issued ? 'Generate another key' : 'Generate API key'}
        </button>

        {issued && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 8 }}>
              Copy the key now — for your security it is shown only this once.
            </div>
            <CopyRow label="Server URL" value={issued.serverUrl} copied={copied === 'url'} onCopy={() => copy('url', issued.serverUrl)} />
            <CopyRow label="API key" value={issued.apiKey} mono copied={copied === 'key'} onCopy={() => copy('key', issued.apiKey)} />
            <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
              {issued.expiresAt
                ? `Valid for ${issued.validityDays} days — until ${formatPkt(issued.expiresAt)}.`
                : 'Never expires — works until you disconnect it below.'}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="settings-btn" onClick={() => copy('both', issued.connectLink)}>
                {copied === 'both' ? 'Copied' : 'Copy both (one line)'}
              </button>
              <span style={{ fontSize: 12, color: '#999' }}>Paste it into the Suzi app's Connect field.</span>
            </div>
          </div>
        )}
        {msg && <div style={{ fontSize: 12, color: msg.ok ? '#4ade80' : '#fca5a5', marginTop: 8 }}>{msg.text}</div>}
      </section>

      <section className="settings-section">
        <h2>Your keys and computers</h2>
        {devices === null && <div style={{ fontSize: 12, color: '#999' }}>Loading…</div>}
        {devices && devices.length === 0 && <div style={{ fontSize: 12, color: '#999' }}>No active keys yet.</div>}
        {devices && devices.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {devices.map((d) => (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {label(d)}{' '}
                    <span style={{ fontSize: 11, color: d.online ? '#4ade80' : '#999', fontWeight: 400 }}>
                      {d.online ? '● connected now' : '○ not connected'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#999' }}>
                    device number <span style={{ fontFamily: 'monospace' }}>{d.id}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#999' }}>
                    created {formatPkt(d.connectedAt)}
                    {d.expiresAt ? ` · expires ${formatPkt(d.expiresAt)}` : d.keyPrefix ? ' · never expires' : ''}
                    {d.lastSeenAt ? ` · last used ${formatPkt(d.lastSeenAt)}` : ' · not used yet'}
                  </div>
                </div>
                <InlineConfirm
                  label="Disconnect"
                  confirmLabel="Disconnect"
                  kind="danger"
                  consequence="This key stops working at once; Suzi on that computer needs a new key."
                  onConfirm={() => disconnect(d)}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

// Link T30: the latest installer from Suzi Master, for this computer's system only. Nothing is stored at Nexeo; the
// download link lasts 10 minutes.
function DownloadSuzi() {
  const [inst, setInst] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    listInstallers().then(setInst).catch((e) => { setInst({}); setErr(errorText(e)); });
  }, []);
  const download = async (os) => {
    setBusy(os);
    setErr(null);
    try {
      const { url } = await installerLink(os);
      window.location.href = url;
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  // Founder 11-11: show only the installer for this computer's system. Both only when the system is not
  // recognised (Linux, a phone), so nobody is left without a choice.
  const order = THIS_OS ? [THIS_OS] : ['macos', 'windows'];
  return (
    <section className="settings-section">
      <h2>Download Suzi</h2>
      <p style={{ fontSize: 12, color: '#666', marginTop: -4, marginBottom: 10 }}>
        Install Suzi on your computer, then connect her below with your key. This is always the latest version.
      </p>
      {inst === null && <div style={{ fontSize: 12, color: '#999' }}>Loading…</div>}
      {inst && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {order.map((os) => {
            const i = inst[os] ?? { available: false };
            return (
              <div key={os} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {OS_NAME[os]}
                  </div>
                  <div style={{ fontSize: 12, color: '#999' }}>
                    {i.available
                      ? <>version {i.version}{i.size ? ` · ${Math.round(i.size / 1048576)} MB` : ''} · sha256 <span style={{ fontFamily: 'monospace' }}>{String(i.sha256).slice(0, 16)}…</span></>
                      : i.error ? i.error : 'Not available yet'}
                  </div>
                </div>
                <button className="settings-btn" disabled={!i.available || busy === os} onClick={() => download(os)}>
                  {busy === os ? <><span className="btn-spinner" /> Preparing…</> : 'Download'}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {err && <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 8 }}>{err}</div>}
    </section>
  );
}

function label(d) {
  return d.keyPrefix ? `Key ${d.keyPrefix}…` : d.name;
}

function CopyRow({ label: text, value, mono = false, copied, onCopy }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>{text}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          readOnly
          value={value}
          aria-label={text}
          onClick={(e) => e.target.select()}
          style={{
            fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 13 : 14, padding: '8px 10px', minWidth: 320, flex: '1 1 320px',
            // Same as .settings-field inputs; without this the browser's read-only look made the value unreadable.
            background: 'var(--bg-input)', color: 'var(--text-primary)', WebkitTextFillColor: 'var(--text-primary)',
            border: '1px solid var(--border-input)', borderRadius: 'var(--radius-sm)', opacity: 1,
          }}
        />
        <button className="settings-btn" onClick={onCopy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}
