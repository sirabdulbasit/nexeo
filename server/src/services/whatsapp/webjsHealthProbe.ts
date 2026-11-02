/**
 * DEF-360 — health comes from the browser, not from a flag.
 *
 * 2026-10-26 11:07 PKT the kernel OOM-killed the WhatsApp Chrome. For ~2 h
 * Brain's WhatsApp was dead and nothing noticed: the watchdog's per-minute
 * `testConnection` only checked that a Client object was still in the
 * in-memory map and that statusMap said 'connected' — both stayed true over a
 * dead page, so every probe "passed" (and a passing probe logs nothing). The
 * first evidence was a send failing `Attempted to use detached Frame` at 12:20.
 * Same class as DEF-340 / DEF-342: a status that claims health without
 * evidence. So the probe now asks the browser itself:
 *
 *   - browser process disconnected, page closed, or a page call failing with
 *     Target closed / detached Frame / Session closed / Execution context was
 *     destroyed ⇒ DEAD at once (definitive — the watchdog re-initialises and,
 *     if that fails, alerts, exactly as for any other failed probe);
 *   - `client.getState()` (runs inside the page) must answer CONNECTED;
 *   - a page call that is merely SLOW (timeout) needs two consecutive misses
 *     before it counts — a loaded box must not cause a reconnect every minute.
 *
 * Pure apart from the client it is handed; the counter is per tenant.
 */
export const HEALTH_PROBE_TIMEOUT_MS = 10_000;
export const SLOW_PROBES_BEFORE_DEAD = 2;

const DEFINITIVE = /target closed|detached frame|session closed|execution context was destroyed|browser has disconnected|protocol error.*(closed|detached)/i;

export interface HealthProbeResult {
  healthy: boolean;
  /** Why not, in log/admin words; null when healthy. */
  reason: string | null;
  /** 'definitive' failures skip the slow-probe grace. */
  kind: 'ok' | 'definitive' | 'slow' | 'state';
}

const slowStreak = new Map<string, number>();

/** Test hook. */
export function __resetHealthProbe(): void { slowStreak.clear(); }

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    (t as any).unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Probe one whatsapp-web.js client. `client` is the live Client (pupBrowser,
 * pupPage, getState). Never throws.
 */
export async function probeClientHealth(
  clientNumber: string,
  client: any,
  opts: { timeoutMs?: number } = {},
): Promise<HealthProbeResult> {
  const dead = (reason: string): HealthProbeResult => {
    slowStreak.delete(clientNumber);
    return { healthy: false, reason, kind: 'definitive' };
  };
  try {
    const browser = client?.pupBrowser;
    if (browser && typeof browser.isConnected === 'function' && !browser.isConnected()) {
      return dead('the WhatsApp browser process is gone');
    }
    const page = client?.pupPage;
    if (!page) return dead('the WhatsApp page is missing');
    if (typeof page.isClosed === 'function' && page.isClosed()) return dead('the WhatsApp page is closed');
    if (typeof client.getState !== 'function') return { healthy: true, reason: null, kind: 'ok' };

    const state = await withTimeout(Promise.resolve(client.getState()), opts.timeoutMs ?? HEALTH_PROBE_TIMEOUT_MS);
    if (state === 'CONNECTED') {
      slowStreak.delete(clientNumber);
      return { healthy: true, reason: null, kind: 'ok' };
    }
    // Unpaired / taken over / blocked will not come back by waiting.
    if (typeof state === 'string' && DEFINITIVE_STATES.has(state)) {
      slowStreak.delete(clientNumber);
      return { healthy: false, reason: `WhatsApp reports state ${state}`, kind: 'state' };
    }
    // OPENING / TIMEOUT / null happen briefly during a normal reconnect:
    // the same two-strikes grace as a slow answer.
    return strike(clientNumber, `WhatsApp reports state ${state ?? 'unknown'}`, 'state');
  } catch (err: any) {
    const msg = String(err?.message ?? err ?? 'probe failed');
    if (DEFINITIVE.test(msg)) return dead(`the WhatsApp page is dead (${msg.slice(0, 120)})`);
    if (/timed out after/.test(msg)) return strike(clientNumber, 'the WhatsApp page did not answer', 'slow');
    // An unknown page error is not proof of death; count it like a slow answer.
    return strike(clientNumber, `the WhatsApp page failed a check (${msg.slice(0, 120)})`, 'slow');
  }
}

/** WAState values that waiting will not fix. */
const DEFINITIVE_STATES = new Set(['UNPAIRED', 'UNPAIRED_IDLE', 'CONFLICT', 'TOS_BLOCK', 'SMB_TOS_BLOCK', 'PROXYBLOCK', 'DEPRECATED_VERSION']);

/** One more strike; unhealthy only at SLOW_PROBES_BEFORE_DEAD consecutive. */
function strike(clientNumber: string, why: string, kind: 'slow' | 'state'): HealthProbeResult {
  const n = (slowStreak.get(clientNumber) ?? 0) + 1;
  slowStreak.set(clientNumber, n);
  if (n < SLOW_PROBES_BEFORE_DEAD) return { healthy: true, reason: null, kind: 'ok' };
  slowStreak.delete(clientNumber);
  return { healthy: false, reason: `${why} — ${n} consecutive checks`, kind };
}
