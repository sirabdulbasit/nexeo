/**
 * DEF-360 — Brain's WhatsApp was dead ~2 h (2026-10-26, Chrome OOM-killed at
 * 11:07 PKT) and the per-minute watchdog never noticed: testConnection only
 * checked an in-memory map + a status flag. probeClientHealth asks the browser.
 *
 * Pinned (each would have caught 10-26):
 *  1. browser disconnected / page closed / page missing ⇒ unhealthy at once;
 *  2. a page call failing "Target closed" / "detached Frame" ⇒ unhealthy at once;
 *  3. getState CONNECTED ⇒ healthy; UNPAIRED / CONFLICT ⇒ unhealthy at once;
 *  4. a slow page or a transient state (OPENING) needs TWO consecutive misses;
 *  5. a healthy answer resets the streak; tenants are counted separately.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { probeClientHealth, __resetHealthProbe } from '../src/services/whatsapp/webjsHealthProbe';

const client = (o: { connected?: boolean; closed?: boolean; noPage?: boolean; state?: () => Promise<any> } = {}) => ({
  pupBrowser: { isConnected: () => o.connected ?? true },
  pupPage: o.noPage ? null : { isClosed: () => o.closed ?? false },
  getState: o.state ?? (async () => 'CONNECTED'),
});
const never = () => new Promise(() => {});

beforeEach(() => __resetHealthProbe());

describe('DEF-360 health comes from the browser', () => {
  it('the 10-26 case: browser process gone ⇒ unhealthy on the FIRST check', async () => {
    const r = await probeClientHealth('T', client({ connected: false }));
    expect(r).toMatchObject({ healthy: false, kind: 'definitive' });
    expect(r.reason).toMatch(/browser process is gone/);
  });

  it('page closed or missing ⇒ unhealthy at once', async () => {
    expect((await probeClientHealth('T', client({ closed: true }))).healthy).toBe(false);
    expect((await probeClientHealth('T', client({ noPage: true }))).healthy).toBe(false);
  });

  it('"Attempted to use detached Frame" / "Target closed" from the page ⇒ unhealthy at once', async () => {
    for (const msg of ["Attempted to use detached Frame '40A1'.", 'Protocol error (Runtime.callFunctionOn): Target closed.', 'Session closed. Most likely the page has been closed.']) {
      __resetHealthProbe();
      const r = await probeClientHealth('T', client({ state: async () => { throw new Error(msg); } }));
      expect(r).toMatchObject({ healthy: false, kind: 'definitive' });
    }
  });

  it('CONNECTED is healthy; UNPAIRED and CONFLICT are not, at once', async () => {
    expect((await probeClientHealth('T', client())).healthy).toBe(true);
    expect((await probeClientHealth('T', client({ state: async () => 'UNPAIRED' }))).healthy).toBe(false);
    expect((await probeClientHealth('T', client({ state: async () => 'CONFLICT' }))).healthy).toBe(false);
  });

  it('a slow page needs two consecutive misses (a loaded box must not force reconnects)', async () => {
    const slow = client({ state: never });
    expect((await probeClientHealth('T', slow, { timeoutMs: 20 })).healthy).toBe(true);
    const second = await probeClientHealth('T', slow, { timeoutMs: 20 });
    expect(second).toMatchObject({ healthy: false, kind: 'slow' });
  });

  it('a transient state (OPENING) gets the same grace; a healthy answer resets the streak', async () => {
    const opening = client({ state: async () => 'OPENING' });
    expect((await probeClientHealth('T', opening)).healthy).toBe(true);
    expect((await probeClientHealth('T', client())).healthy).toBe(true);           // reset
    expect((await probeClientHealth('T', opening)).healthy).toBe(true);            // first strike again
    expect((await probeClientHealth('T', opening)).healthy).toBe(false);           // second
  });

  it('streaks are per tenant', async () => {
    const slow = client({ state: never });
    expect((await probeClientHealth('A', slow, { timeoutMs: 20 })).healthy).toBe(true);
    expect((await probeClientHealth('B', slow, { timeoutMs: 20 })).healthy).toBe(true);
  });
});
