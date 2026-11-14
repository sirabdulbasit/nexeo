/**
 * F-2.4 stale-claim re-queue on a REAL Postgres (Suzi Master, 14 Nov): Gmail is faked to stall or "crash" right after
 * it creates a draft; everything else is Nexeo's own code (emailDelegate → saveToGmailDrafts → hold → releaseHeldSend,
 * and the job's voidStaleClaims) against a throwaway server. Runs only with RACE_PG_URL; refuses any server but port
 * 55432 / database race.
 *   stall: tick A creates its draft and stalls past the re-queue; tick B (the re-queue) is held and sent; A wakes,
 *          is fenced (holds nothing), deletes its draft. One send in all.
 *   crash: tick A recorded its draft id, then died before the hold. The sweep gives the key up and deletes that draft;
 *          the re-queue sends. One send, no draft left behind.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const URL_ = vi.hoisted(() => { const u = process.env.RACE_PG_URL; if (u) process.env.DATABASE_URL = u; return u; });
const g = vi.hoisted(() => ({ created: [] as string[], sent: [] as string[], deleted: [] as string[], stall: null as null | Promise<void>, n: 0 }));

vi.mock('../src/services/suzi/suziPeople', () => ({ personById: async () => ({ id: 'p1', name: 'Ali', email: 'ali@tmc.com' }) }));
vi.mock('../src/services/auditLogService', () => ({ audit: async () => undefined }));
vi.mock('../src/services/featureFlagService', () => ({ getFlagValue: async () => '' }));
vi.mock('../src/services/gmailService', () => ({
  createGmailDraft: async () => { const id = `gd${++g.n}`; g.created.push(id); const wait = g.stall; if (wait) { g.stall = null; await wait; } return { success: true, draftId: id }; },
  getEmailHeadersForReply: async () => ({}),
  sendGmailDraft: async (_u: number, d: string) => { g.sent.push(d); return { success: true, messageId: `m-${d}` }; },
  sentReceipt: async () => 'sent',
  deleteGmailDraft: async (_u: number, d: string) => { g.deleted.push(d); return { success: true }; },
}));
vi.mock('../src/services/suzi/suziEmail', async (orig) => {
  const real: any = await orig();
  const prisma = (await import('../src/db/prisma')).default;
  return {
    ...real,
    latestMail: async () => ({ subject: 'Quote', senderEmail: 'v@vendor.com' }),
    forwardEmail: async () => {
      const r = await prisma.$queryRawUnsafe<Array<{ id: number }>>(`INSERT INTO agent_actions (client_number, user_id, action_type, input, output) VALUES ('RACE', 2, 'draft_reply', '{}', '{"to":"ali@tmc.com","subject":"Fwd: Quote","body":"x"}') RETURNING id`);
      return { ok: true, item: { draft_id: String(r[0].id) } };
    },
  };
});
vi.mock('../src/services/suzi/suziDelegate', async (orig) => ({ ...(await orig() as any), afterSuziSent: async () => undefined }));

const run = URL_ ? describe : describe.skip;
run('F-2.4 stale claim on a real Postgres', () => {
  let prisma: any; let emailDelegate: any; let releaseHeldSend: any; let voidStaleClaims: any;
  const later = () => new Date(Date.now() + 20_000); // past the 10 s hold
  const gate = { signatureVerified: false, voiceScore: null, byRule: 'r1' };
  const tick = (mid: string) => emailDelegate('RACE', 2, { email_id: 't1', rule_id: 'r1', person_id: 'p1', message_id: mid }, true, gate);
  const age = (id: number) => prisma.$executeRawUnsafe(`UPDATE agent_actions SET created_at = now() - interval '11 minutes' WHERE id = $1`, id);
  const row = async (id: number) => (await prisma.$queryRawUnsafe(`SELECT idempotency_key AS k, output FROM agent_actions WHERE id = $1`, id))[0];
  beforeAll(async () => {
    prisma = (await import('../src/db/prisma')).default;
    const p = await prisma.$queryRawUnsafe(`SELECT current_setting('port') AS p, current_database() AS d`);
    if (p[0].p !== '55432' || p[0].d !== 'race') throw new Error(`refusing: not the throwaway server (${JSON.stringify(p)})`);
    ({ emailDelegate } = await import('../src/services/suzi/suziDelegate'));
    const send = await import('../src/services/suzi/suziSend');
    releaseHeldSend = send.releaseHeldSend; send.setSendScheduler(() => undefined); // releases run by hand
    ({ voidStaleClaims } = await import('../src/jobs/ruleForwardJob'));
  });
  beforeEach(async () => { await prisma.$executeRawUnsafe(`DELETE FROM agent_actions WHERE client_number = 'RACE'`); g.created = []; g.sent = []; g.deleted = []; g.stall = null; });

  it('stall: the stalled tick wakes after the re-queue, is fenced, and deletes its draft; one send', async () => {
    let wake!: () => void; g.stall = new Promise<void>((r) => { wake = r; });
    const a = tick('m-stall');                                   // A: claims, creates gd1, stalls in Gmail
    await new Promise((r) => setTimeout(r, 50));
    const [{ id: aId }] = await prisma.$queryRawUnsafe(`SELECT id FROM agent_actions WHERE client_number = 'RACE' ORDER BY id LIMIT 1`);
    await age(aId);
    expect(await voidStaleClaims('RACE', 2)).toBe(1);            // the sweep gives A's key up
    const b: any = await tick('m-stall');                         // B: the re-queue, claims afresh
    expect(b.ok).toBe(true);
    const bId = Number(b.item.draft_id);
    expect(await releaseHeldSend(bId, later())).toBe('sent');
    wake();                                                       // A wakes
    const aOut: any = await a;
    expect(aOut).toMatchObject({ ok: false, error: 'claim_lost' });
    expect((await row(aId)).output.send).toMatchObject({ state: 'cancelled', requeue: true });
    expect(await releaseHeldSend(aId, later())).toBe('skipped'); // and nothing of A can be released
    console.log(JSON.stringify({ case: 'stall', created: g.created, sent: g.sent, deleted: g.deleted, aKey: (await row(aId)).k.includes(':void:') ? 'void' : 'live' }));
    expect(g.sent).toEqual(['gd2']);
    expect(g.deleted).toContain('gd1');
  });

  it('crash: a recorded draft and no hold; the sweep deletes the draft and the re-queue sends once', async () => {
    const [{ id: aId }] = await prisma.$queryRawUnsafe(
      `INSERT INTO agent_actions (client_number, user_id, action_type, idempotency_key, input, output, created_at)
       VALUES ('RACE', 2, 'draft_reply', $1, '{"delegate":{"by_rule":true,"message_id":"m-crash","rule_id":"r1","person_id":"p1","person_email":"ali@tmc.com"}}',
               '{"to":"ali@tmc.com","gmailDraftId":"gd-orphan"}', now() - interval '11 minutes') RETURNING id`,
      (await import('../src/services/suzi/suziDelegate')).ruleForwardKey('RACE', 2, 'm-crash', 'ali@tmc.com'),
    );
    expect(await tick('m-crash')).toMatchObject({ ok: false, error: 'already_forwarded' }); // before the sweep: blocked
    expect(await voidStaleClaims('RACE', 2)).toBe(1);
    expect(g.deleted).toEqual(['gd-orphan']);
    const b: any = await tick('m-crash');
    expect(b.ok).toBe(true);
    expect(await releaseHeldSend(Number(b.item.draft_id), later())).toBe('sent');
    console.log(JSON.stringify({ case: 'crash', created: g.created, sent: g.sent, deleted: g.deleted }));
    expect(g.sent).toHaveLength(1);
    expect((await row(aId)).output.send).toMatchObject({ state: 'cancelled', requeue: true });
  });
});
