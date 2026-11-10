// DEF-377 — the Suzi hook sits in the REAL brainContactsUser chokepoint (def308 harness pattern):
// called once, after Nexeo's own gates pass, with the final body; never when a gate holds the
// message; and it can never change what brainContactsUser returns.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const waSent = vi.hoisted(() => [] as Array<{ body: string }>);
const state = vi.hoisted(() => ({
  sent: [] as string[],
  created: [] as any[],
  reservePct: 25 as number,
  digestCountThrows: false,
  outboundEnabled: true,
  waFails: false,
}));
const told = vi.hoisted(() => [] as Array<{ owner: any; msg: any }>);
const tellBehaviour = vi.hoisted(() => ({ reject: false }));

vi.mock('../src/db/prisma', () => {
  const brainUserMessage = {
    findFirst: async () => null,       // no dedup hit, no per-kind rate limit hit
    findMany: async () => [],          // the digest's held-rows query
    count: async ({ where }: any) => {
      const k = where?.kind;
      if (k === undefined) return state.sent.length;                          // daily cap
      if (typeof k === 'string') {                                            // digest window
        if (state.digestCountThrows) throw new Error('count failed');
        return state.sent.filter((x) => x === k).length;
      }
      if (k?.in) return state.sent.filter((x) => k.in.includes(x)).length;    // tier budgets
      if (k?.notIn) return state.sent.filter((x) => !k.notIn.includes(x)).length; // human reserve
      return 0;
    },
    create: async ({ data }: any) => { state.created.push(data); return { id: `rec-${state.created.length}` }; },
  };
  const model = {
    findUnique: async (args: any) => (args?.where?.clientNumber
      ? { name: 'TallyMarks Consulting', domain: 'tmcltd.com' }
      : {
        id: 2, name: 'Basit Ahmed', email: 'basit.ahmed@tmcltd.ai',
        clientNumber: 'TMC-0001', isActive: true, contactNumber: '+923000000000',
        notificationPreferences: {
          profile: { preferredTitle: 'Sir' },
          brain_channel: { outboundEnabled: state.outboundEnabled, outboundPaused: false, timezone: 'UTC' },
        },
      }),
    findFirst: async (args: any) => (
      args?.where?.id === 2 && args?.where?.clientNumber === 'TMC-0001'
        ? (await model.findUnique({ where: { id: 2 } } as any)) : null),
    findMany: async () => [], create: async () => ({ id: 'x' }), update: async () => ({}),
    updateMany: async () => ({ count: 0 }), upsert: async () => ({}), count: async () => 0,
    aggregate: async () => ({}), groupBy: async () => [],
  };
  const p: any = new Proxy(
    { brainUserMessage, $queryRaw: async () => [], $queryRawUnsafe: async () => [], $executeRaw: async () => 0, $executeRawUnsafe: async () => 0 },
    { get: (t: any, k: string) => (k in t ? t[k] : model) },
  );
  return { __esModule: true, default: p, prisma: p };
});

vi.mock('../src/services/notifications/tenantWhatsappSender', () => ({
  sendTenantWhatsAppText: async (_c: string, _p: string, body: string) => {
    if (state.waFails) return { ok: false, error: 'wa down' };
    waSent.push({ body });
    return { ok: true, waMessageId: `wa-${waSent.length}` };
  },
  sendTenantWhatsAppVoiceNote: async () => ({ ok: true, waMessageId: 'wa-v' }),
}));

// Office hours (DEF-120) would hold a low-urgency send outside 9–18 and make
// these results depend on the clock. Open the office so the BUDGET gate is
// what is being proven.
vi.mock('../src/services/behaviorConfig', () => ({
  getBehaviorValue: async (key: string) => {
    if (key === 'notify.office_start_hour') return 0;
    if (key === 'notify.office_end_hour') return 24;
    if (key === 'notify.office_days_mask') return 127;
    if (key === 'notify.human_reserve_pct') return state.reservePct;
    return 50; // tier budget pcts
  },
}));

vi.mock('../src/services/llmRouter', () => ({
  callLLM: async () => ({ text: 'held some notifications today' }),
}));

vi.mock('../src/services/suzi/gatewayAdminClient', () => ({
  tellSuzi: async (owner: any, msg: any) => {
    told.push({ owner, msg });
    if (tellBehaviour.reject) throw new Error('suzi exploded');
    return { delivered: 1 };
  },
}));

import { brainContactsUser, __resetSuppressionDigestClaimsForTests } from '../src/services/notifications/brainOutboundService';

const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };
const base = { userId: 2, clientNumber: 'TMC-0001', summary: 'Two critical emails', body: 'Ali and Sara both need the audit file today.' };

beforeEach(() => {
  __resetSuppressionDigestClaimsForTests();
  waSent.length = 0;
  told.length = 0;
  state.sent = [];
  state.created = [];
  state.outboundEnabled = true;
  state.waFails = false;
  tellBehaviour.reject = false;
});

describe('DEF-377 — brainContactsUser also tells Suzi', () => {
  it('a delivered critical email bundle is handed to Suzi once, with the body he got and its urgency', async () => {
    const r = await brainContactsUser({ ...base, kind: 'critical_bundle', urgency: 'high', dedupKey: 'c:1', metadata: { feedEventIds: ['f1'] } });
    expect(r.sent).toBe(true);
    await flush();
    expect(told).toHaveLength(1);
    expect(told[0].owner).toEqual({ userId: 2, clientNumber: 'TMC-0001' });
    expect(told[0].msg).toMatchObject({ kind: 'critical_bundle', body: base.body, urgency: 'high', metadata: { feedEventIds: ['f1'] } });
    expect(waSent.length).toBeGreaterThan(0); // WhatsApp delivery unchanged (high urgency sends more than one part)
  });

  it('a message Nexeo holds back (outbound turned off) never reaches Suzi either', async () => {
    state.outboundEnabled = false;
    const r = await brainContactsUser({ ...base, kind: 'critical_bundle', dedupKey: 'c:2' });
    expect(r.sent).toBe(false);
    await flush();
    expect(told).toHaveLength(0);
  });

  it('a Suzi failure changes nothing about the result Nexeo returns', async () => {
    const ok = await brainContactsUser({ ...base, kind: 'brain_prompt', dedupKey: null, metadata: { source: 'preactive_meeting_prep' } });
    tellBehaviour.reject = true;
    const again = await brainContactsUser({ ...base, kind: 'brain_prompt', body: 'Another reminder.', dedupKey: null, metadata: { source: 'preactive_meeting_prep' } });
    await flush();
    expect(ok.sent).toBe(true);
    expect(again.sent).toBe(true);
    expect(told).toHaveLength(2);
  });
  it('a failed send (WhatsApp down, no fallback) is not told: the queue retries it and Suzi would repeat itself', async () => {
    state.waFails = true;
    const r = await brainContactsUser({ ...base, kind: 'brain_prompt', dedupKey: null, metadata: { source: 'preactive_meeting_prep' } });
    await flush();
    if (r.sent) throw new Error(`expected a failed send in this harness, got ${JSON.stringify(r)}`);
    expect(told).toHaveLength(0);
  });

  it('a smoke send (suppressed by Nexeo) is not told', async () => {
    const r = await brainContactsUser({ ...base, kind: 'critical_bundle', dedupKey: 'c:smoke', metadata: { smoke: true } });
    await flush();
    expect(r.sent).toBe(false);
    expect(told).toHaveLength(0);
  });

  it('third-party provenance is passed through, and synthetic @lid numbers are scrubbed before Suzi hears them', async () => {
    await brainContactsUser({ ...base, kind: 'brain_prompt', provenance: 'quoted_third_party', body: 'Ahmed (+123456789012345) has not replied.', dedupKey: null, metadata: { source: 'preactive_meeting_prep' } });
    await flush();
    expect(told).toHaveLength(1);
    expect(told[0].msg.provenance).toBe('quoted_third_party');
    expect(told[0].msg.body).not.toContain('123456789012345');
  });
});
