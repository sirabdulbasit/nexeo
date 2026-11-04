/**
 * Functional Charter, through the REAL chokepoint (brainContactsUser):
 *  - a user whose Suzi sends presence gets no WhatsApp and no WhatsApp fallback email; the item goes in
 *    the outbox and the ledger row is on the 'suzi' channel, so caps and dedup keep working;
 *  - Brain's "what did I send?" record is not written for an item that is only held;
 *  - a user with no presence row goes exactly as before;
 *  - things asked for just now, and the morning brief, are not rerouted;
 *  - quiet hours do not drop an adopted user's item: the charter's rules hold it instead;
 *  - presence alone changes nothing: until the kick-off switch is on, WhatsApp goes as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ created: [] as any[], wa: [] as any[], artifacts: 0, adopted: false, held: [] as any[], pumped: 0, quiet: {} as any }));

vi.mock('../src/db/prisma', () => {
  const user = {
    id: 2, name: 'B', email: 'b@tmcltd.ai', clientNumber: 'TMC-0001', isActive: true, contactNumber: '+923000000000',
    get notificationPreferences() { return { brain_channel: { outboundEnabled: true, outboundPaused: false, timezone: 'UTC', ...state.quiet } }; },
  };
  const brainUserMessage = {
    findFirst: async () => null, findMany: async () => [], count: async () => 0,
    create: async ({ data }: any) => { state.created.push(data); return { id: `rec-${state.created.length}` }; },
  };
  const model = {
    findUnique: async () => user, findFirst: async () => user, findMany: async () => [], create: async () => ({ id: 'x' }),
    update: async () => ({}), updateMany: async () => ({ count: 0 }), upsert: async () => ({}), count: async () => 0, aggregate: async () => ({}), groupBy: async () => [],
  };
  const p: any = new Proxy(
    { brainUserMessage, $queryRaw: async () => [], $queryRawUnsafe: async () => [], $executeRaw: async () => 0, $executeRawUnsafe: async () => 0 },
    { get: (t: any, k: string) => (k in t ? t[k] : model) },
  );
  return { __esModule: true, default: p, prisma: p };
});
vi.mock('../src/services/notifications/tenantWhatsappSender', () => ({
  sendTenantWhatsAppText: async (...a: any[]) => { state.wa.push(a); return { ok: true, waMessageId: 'wa1' }; },
  sendTenantWhatsAppVoiceNote: async (...a: any[]) => { state.wa.push(a); return { ok: true, waMessageId: 'wa2' }; },
}));
vi.mock('../src/services/knowledge/brainActionArtifactService', () => ({ recordArtifact: async () => { state.artifacts++; } }));
vi.mock('../src/services/whatsapp/sessionHistoryService', () => ({ appendBrainTurnToSession: async () => {} }));
vi.mock('../src/services/suzi/gatewayAdminClient', () => ({ tellSuzi: async () => ({ delivered: 0 }), noticeSuzi: async () => ({ delivered: 0 }), suziReasonFor: () => null }));
vi.mock('../src/services/suzi/suziReach', () => ({
  reachFor: async () => ({ adopted: state.adopted, alive: state.adopted, absentMs: 0 }),
  holdItem: async (i: any) => { state.held.push(i); return '77'; },
  pumpHeld: async () => { state.pumped++; return { spoken: 0, carded: 1, emailed: 0, expired: 0 }; },
}));

import { brainContactsUser } from '../src/services/notifications/brainOutboundService';

const send = (o: any = {}) => brainContactsUser({ userId: 2, clientNumber: 'TMC-0001', kind: 'connector_stale', summary: 'Gmail is stale', body: 'Gmail needs reconnecting', urgency: 'normal', dedupKey: null, ...o });

beforeEach(() => { Object.assign(state, { created: [], wa: [], artifacts: 0, adopted: false, held: [], pumped: 0, quiet: {} }); });

describe('presence before the kick-off', () => {
  it('a Mac sending presence moves nothing while the switch is off', async () => {
    state.adopted = true;
    const r = await send();
    expect(state.held).toHaveLength(0);
    expect(state.wa).toHaveLength(1);
    expect(r.channelsUsed).toEqual(['text']);
  });
});

describe('an adopted user', () => {
  beforeEach(() => { state.adopted = true; state.quiet = { suziReachOn: true }; });
  it('no WhatsApp: outbox, pump, one ledger row on the suzi channel', async () => {
    const r = await send();
    expect(state.wa).toHaveLength(0);
    expect(state.held[0]).toMatchObject({ kind: 'connector_stale', body: 'Gmail needs reconnecting', urgency: 'normal' });
    expect(state.pumped).toBe(1);
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({ channel: 'suzi', status: 'sent' });
    expect(state.created[0].metadata.suzi_outbox_id).toBe('77');
    expect(r).toMatchObject({ sent: true, channelsUsed: ['suzi'] });
  });
  it('held is not "sent": Brain\'s own record waits for the real delivery', async () => {
    await send();
    expect(state.artifacts).toBe(0);
  });
  it('quiet hours do not drop it; the charter holds it', async () => {
    state.quiet = { suziReachOn: true, quietStart: '00:00', quietEnd: '23:59' };
    const r = await send();
    expect(r.sent).toBe(true);
    expect(state.held).toHaveLength(1);
  });
  it('the morning brief and a test the person pressed are not rerouted', async () => {
    await send({ kind: 'day_brief', dedupKey: 'a', body: 'Good morning' });
    await send({ kind: 'connector_stale', bypassOptIn: true, dedupKey: 'b', body: 'Test ping' });
    expect(state.held).toHaveLength(0);
    expect(state.wa.length).toBeGreaterThan(0);
  });
});

describe('a user with no presence', () => {
  it('goes exactly as before', async () => {
    const r = await send();
    expect(state.held).toHaveLength(0);
    expect(state.wa).toHaveLength(1);
    expect(state.created[0]).toMatchObject({ status: 'sent', channel: 'text' });
    expect(state.artifacts).toBe(1);
    expect(r.channelsUsed).toEqual(['text']);
  });
  it('quiet hours still stop it, as before', async () => {
    state.quiet = { quietStart: '00:00', quietEnd: '23:59' };
    const r = await send();
    expect(r.sent).toBe(false);
    expect(state.wa).toHaveLength(0);
    expect(state.created[0]).toMatchObject({ status: 'suppressed' });
  });
});
