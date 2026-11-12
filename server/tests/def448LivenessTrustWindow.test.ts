/**
 * DEF-448 (CL-086, 2026-11-12): a `[nexeo-liveness …]` token in his self-chat after almost every restart.
 * Owner's choice: "Trust 12 hours". Pinned:
 *  - a restart 3 hours after a pass trusts it (no token); 13 hours after, it probes again;
 *  - a real send WhatsApp accepted is stored as a pass under the same key the restart reads.
 */
import { describe, it, expect, vi } from 'vitest';

const setConfig = vi.fn(async () => undefined);
vi.mock('../src/services/configService', () => ({ setConfig: (...a: any[]) => (setConfig as any)(...a), getConfig: async () => null }));

import { mayTrustRecentPass, persistOutboundPass, PROBE_LAST_PASS_KEY } from '../src/services/whatsapp/webjsLiveness';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const H = 60 * 60_000;

describe('DEF-448 trust a pass for 12 hours', () => {
  it('a restart 3 hours after a pass sends no probe; 13 hours after, it does', () => {
    expect(mayTrustRecentPass(ago(3 * H)).trust).toBe(true);
    expect(mayTrustRecentPass(ago(13 * H)).trust).toBe(false);
  });
  it('a real send is stored as a pass under the key the restart reads', async () => {
    const now = new Date('2026-11-12T11:00:00Z');
    await persistOutboundPass('TMC-0001', now);
    expect(setConfig).toHaveBeenCalledWith('TMC-0001', PROBE_LAST_PASS_KEY, now.toISOString(), false, expect.any(String));
  });
});
