/**
 * LLM Consumption page: what we recorded (per client, user, service, date, month) and, for super
 * admins, what Google actually charged, from the billing export.
 */
import { useEffect, useState } from 'react';
import api from '../../services/api';

const GROUPS = [['client', 'Client'], ['user', 'User'], ['service', 'Service'], ['day', 'Date'], ['month', 'Month']];
const usd = (n) => `$${Number(n ?? 0).toFixed(2)}`;
const count = (n) => Number(n ?? 0).toLocaleString();

export function ConsumptionPanel({ user }) {
  const superAdmin = !!user?.isSuperAdmin;
  const now = new Date().toISOString().slice(0, 10);
  const [groupBy, setGroupBy] = useState(superAdmin ? 'client' : 'user');
  const [from, setFrom] = useState(`${now.slice(0, 7)}-01`);
  const [to, setTo] = useState(now);
  const [report, setReport] = useState(null);
  const [err, setErr] = useState(null);
  const groups = superAdmin ? GROUPS : GROUPS.filter(([k]) => k !== 'client');

  useEffect(() => {
    let live = true;
    setErr(null);
    const all = superAdmin ? '&client_number=all' : '';
    api.get(`/admin/consumption?from=${from}&to=${to}&groupBy=${groupBy}${all}`)
      .then(({ data }) => { if (live) setReport(data); })
      .catch((e) => { if (live) setErr(e?.response?.data?.error ?? e.message); });
    return () => { live = false; };
  }, [groupBy, from, to, superAdmin]);

  return (
    <div style={block}>
      <h2 style={{ margin: 0 }}>LLM Consumption</h2>
      <div style={note}>What our own records show{superAdmin ? ' across all clients' : ''}. Cost here is an estimate; dates are UTC.</div>
      <div style={controls}>
        <div style={segRow}>
          {groups.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={groupBy === k} onClick={() => setGroupBy(k)} style={groupBy === k ? segOn : seg}>{label}</button>
          ))}
        </div>
        <input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={dateInput} />
        <span style={note}>&rarr;</span>
        <input type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={dateInput} />
      </div>
      {err && <div className="settings-msg error">{err}</div>}
      {report && (
        <table className="admin-table" style={{ width: '100%' }}>
          <thead><tr><th>{groups.find(([k]) => k === groupBy)?.[1]}</th><th style={num}>Calls</th><th style={num}>Tokens in</th><th style={num}>Cached</th><th style={num}>Tokens out</th><th style={num}>Cost (estimate)</th></tr></thead>
          <tbody>
            {report.rows.length === 0 && <tr><td colSpan={6} style={note}>No consumption in this period.</td></tr>}
            {report.rows.map((r) => (
              <tr key={r.key}><td>{r.key}</td><td style={num}>{count(r.calls)}</td><td style={num}>{count(r.input_tokens)}</td><td style={num}>{count(r.cached_tokens)}</td><td style={num}>{count(r.output_tokens)}</td><td style={num}>{`$${Number(r.est_usd).toFixed(4)}`}</td></tr>
            ))}
            <tr><td><strong>Total</strong></td><td colSpan={4} /><td style={num}><strong>{usd(report.total_usd)}</strong></td></tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ActualCostPanel() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/admin/gcp-billing').then(({ data: d }) => setData(d)).catch((e) => setErr(e?.response?.data?.error ?? e.message));
  useEffect(() => { load(); }, []);

  const refresh = async () => {
    setBusy(true); setErr(null);
    try { await api.post('/admin/gcp-billing/refresh'); await load(); } catch (e) { setErr(e?.response?.data?.error ?? e.message); }
    setBusy(false);
  };
  const toggle = async (id) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDetail(null);
    try { setDetail((await api.get(`/admin/gcp-billing/projects/${encodeURIComponent(id)}`)).data); } catch (e) { setErr(e?.response?.data?.error ?? e.message); }
  };

  return (
    <div style={block}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Actual cost (Google billing)</h2>
        <button className="admin-action" onClick={refresh} disabled={busy || !data?.configured}>{busy ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <div style={note}>Net of credits. Dates are Pacific time, as in the Cloud Billing console. Internal: names client projects.</div>
      {err && <div className="settings-msg error">{err}</div>}
      {data && !data.configured && <div className="settings-msg error">The billing key is not set on the server, so there is no data yet.</div>}
      {data?.sync?.last_error && <div className="settings-msg error">Last refresh failed: {data.sync.last_error}</div>}
      {data && data.days.length > 0 && (
        <>
          <div style={cards}>
            <Card label="This month so far" value={usd(data.month_to_date.net)} sub="still filling in" />
            <Card label="Average finished day" value={data.average_complete_day == null ? 'Not enough days yet' : usd(data.average_complete_day)} sub="excludes unfinished days" />
            <Card label="Monthly budget" value={data.budget ? `${Math.round(data.budget.used_share * 100)}% of ${usd(data.budget.amount)}` : 'Not set'} />
          </div>
          <CostChart days={data.days} />
          <h3 style={h3}>By project, invoice month {data.invoice_month}</h3>
          <table className="admin-table" style={{ width: '100%' }}>
            <thead><tr><th>Project</th><th style={num}>This month</th><th style={num}>{data.previous_invoice_month}</th><th style={num}>Change</th></tr></thead>
            <tbody>
              {data.projects.map((p) => (
                <FragmentRow key={p.project_id} p={p} hasPrevious={data.has_previous_month} isOpen={open === p.project_id} detail={open === p.project_id ? detail : null} onToggle={() => toggle(p.project_id)} />
              ))}
            </tbody>
          </table>
          <h3 style={h3}>By label: client (tenant), feature, app</h3>
          {data.labels.length === 0 ? <div style={note}>No billing labels in this month's data yet.</div> : (
            <table className="admin-table" style={{ width: '100%' }}>
              <thead><tr><th>Label</th><th>Value</th><th style={num}>This month</th></tr></thead>
              <tbody>
                {data.labels.map((l) => <tr key={`${l.label_key}=${l.label_value}`}><td>{l.label_key}</td><td>{l.label_value}</td><td style={num}>{usd(l.net)}</td></tr>)}
                {data.unlabelled_by_key.map((u) => <tr key={u.label_key}><td>{u.label_key}</td><td style={note}>without this label</td><td style={num}>{usd(u.net)}</td></tr>)}
              </tbody>
            </table>
          )}
        </>
      )}
      {data?.configured && data.days.length === 0 && !data.sync?.last_error && <div style={note}>No billing data loaded yet.</div>}
    </div>
  );
}

function FragmentRow({ p, hasPrevious, isOpen, detail, onToggle }) {
  const change = hasPrevious ? usd(p.current_net - p.previous_net) : 'No earlier data';
  return (
    <>
      <tr>
        <td><button type="button" onClick={onToggle} aria-expanded={isOpen} style={linkBtn}>{isOpen ? '▾' : '▸'} {p.project_name || p.project_id}</button></td>
        <td style={num}>{usd(p.current_net)}</td>
        <td style={num}>{hasPrevious ? usd(p.previous_net) : '—'}</td>
        <td style={num}>{change}</td>
      </tr>
      {isOpen && (
        <tr><td colSpan={4}>
          {!detail ? <span style={note}>Loading…</span> : (
            <div style={{ display: 'grid', gap: 10 }}>
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead><tr><th style={left}>Service</th><th style={left}>SKU</th><th style={num}>Net</th></tr></thead>
                <tbody>{detail.skus.map((s) => <tr key={`${s.service}|${s.sku}`}><td>{s.service}</td><td>{s.sku}</td><td style={num}>{`$${s.net.toFixed(4)}`}</td></tr>)}</tbody>
              </table>
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead><tr><th style={left}>Date</th><th style={num}>Net</th></tr></thead>
                <tbody>{detail.days.map((d) => <tr key={d.day}><td>{d.day}{d.incomplete ? ' (not final)' : ''}</td><td style={num}>{usd(d.net)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </td></tr>
      )}
    </>
  );
}

/** Solid line for finished days, dashed with hollow dots for days Google is still finalising. */
function CostChart({ days }) {
  const W = 760; const H = 200; const L = 46; const B = 22; const T = 8;
  const max = Math.max(...days.map((d) => d.net), 0.01);
  const x = (i) => L + (days.length === 1 ? 0 : (i * (W - L - 8)) / (days.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const path = (list) => list.map(([d, i], n) => `${n ? 'L' : 'M'}${x(i)},${y(d.net)}`).join(' ');
  const indexed = days.map((d, i) => [d, i]);
  const firstOpen = indexed.findIndex(([d]) => d.incomplete);
  const done = firstOpen < 0 ? indexed : indexed.slice(0, firstOpen);
  const open = firstOpen < 0 ? [] : indexed.slice(Math.max(0, firstOpen - 1));
  return (
    <figure style={{ margin: '12px 0' }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily net cost, last 60 days" style={{ width: '100%', height: 'auto' }}>
        <line x1={L} x2={W - 8} y1={y(0)} y2={y(0)} stroke="var(--border)" />
        <text x={L - 6} y={y(max) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">{usd(max)}</text>
        <text x={L - 6} y={y(0) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">$0</text>
        <text x={L} y={H - 6} fontSize="11" fill="var(--text-muted)">{days[0].day}</text>
        <text x={W - 8} y={H - 6} textAnchor="end" fontSize="11" fill="var(--text-muted)">{days[days.length - 1].day}</text>
        {done.length > 0 && <path d={path(done)} fill="none" stroke="var(--accent, #c2410c)" strokeWidth="2" />}
        {open.length > 0 && <path d={path(open)} fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="5 4" />}
        {indexed.map(([d, i]) => (
          <circle key={d.day} cx={x(i)} cy={y(d.net)} r="3.5" fill={d.incomplete ? 'var(--bg-1, #fff)' : 'var(--accent, #c2410c)'} stroke={d.incomplete ? 'var(--text-muted)' : 'var(--accent, #c2410c)'}>
            <title>{`${d.day}: ${usd(d.net)}${d.incomplete ? ' (not final)' : ''}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption style={note}>Daily net cost. Dashed, hollow points: not final yet, and will likely rise.</figcaption>
    </figure>
  );
}

function Card({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const block = { marginBottom: 28 };
const note = { fontSize: 12, color: 'var(--text-muted)' };
const controls = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '10px 0' };
const cards = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, margin: '12px 0' };
const h3 = { fontSize: 14, margin: '18px 0 6px' };
const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const left = { textAlign: 'left' };
const dateInput = { padding: '4px 8px', background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6 };
const segRow = { display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' };
const seg = { fontSize: 12, padding: '4px 10px', border: 0, cursor: 'pointer', background: 'transparent', color: 'var(--text-muted)' };
const segOn = { ...seg, background: 'var(--accent, #c2410c)', color: '#fff' };
const linkBtn = { background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', textAlign: 'left' };
