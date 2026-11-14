/**
 * F-2.4 proofs owed before the auto-forward switch (charter F-2.4, Suzi 81af84a; outside review, 13 Nov):
 *  (a) one DB claim per message: two ticks racing, or a tick after a restart, forward a message to a person once;
 *      two releases of one hold send once.
 *  (b) a change of the rule's person, or of that person's email, during the hold cancels the forward (nothing goes)
 *      and queues it again; the new person gets a new claim.
 *  (c) "delivered" only after Gmail's receipt: Gmail's id alone leaves the row "sending"; the SENT label read back
 *      makes it delivered and only then is the task made; not in Gmail = failed; a restart reads it back again.
 * A stateful fake of agent_actions enforces the unique idempotency_key, as Postgres does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = { id: number; client_number: string; user_id: number; action_type: string; idempotency_key: string | null; input: any; output: any; updated_at: Date };
const db = vi.hoisted(() => ({ rows: new Map<number, Row>(), next: 100, rule: { active: true, person_id: 'p1' } as any, persons: new Map<string, any>(),
  gmailSends: 0, receipts: [] as string[], after: [] as number[], drafts: [] as string[], deleted: [] as string[] }));

const merge = (r: Row, patch: any) => { r.output = { ...(r.output ?? {}), send: { ...(r.output?.send ?? {}), ...patch } }; r.updated_at = new Date(); };

vi.mock('../src/db/prisma', () => ({ default: {
  user: { findFirst: async () => ({ integrationProvider: 'google', integrationStatus: 'active' }) },
  agentAction: {
    findFirst: async (q: any) => db.rows.get(q.where.id) ? { ...db.rows.get(q.where.id), clientNumber: db.rows.get(q.where.id)!.client_number, userId: db.rows.get(q.where.id)!.user_id } : null,
    update: async (q: any) => { const r = db.rows.get(q.where.id)!; r.input = q.data.input; return r; },
  },
  $executeRawUnsafe: async (sql: string, ...a: any[]) => {
    if (/SET idempotency_key = \$2/.test(sql)) {
      await new Promise((res) => setTimeout(res, 1)); // let a racing twin interleave
      if ([...db.rows.values()].some((x) => x.idempotency_key === a[1])) throw Object.assign(new Error('unique violation'), { code: 'P2010' });
      const r = db.rows.get(a[0]); if (!r || r.idempotency_key) return 0; r.idempotency_key = a[1]; return 1;
    }
    if (/jsonb_set/.test(sql)) { const r = db.rows.get(a[0]); if (r) merge(r, JSON.parse(a[1])); return 1; }
    return 0;
  },
  $queryRawUnsafe: async (sql: string, ...a: any[]) => {
    if (/SET output = jsonb_set\(output, '\{send,state\}', '"sending"'\)/.test(sql)) {
      const r = db.rows.get(a[0]);
      if (!r || r.output?.send?.state !== 'held') return [];
      merge(r, { state: 'sending' });
      return [{ client_number: r.client_number, user_id: r.user_id, gmail_draft_id: r.output.gmailDraftId, send_at: new Date(r.output.send.send_at),
        rule_id: r.input.delegate?.rule_id, by_rule: r.input.delegate?.by_rule === true, person_id: r.input.delegate?.person_id, person_email: String(r.input.delegate?.person_email ?? '').toLowerCase(), claim_key: r.idempotency_key }];
    }
    if (/SELECT EXISTS/.test(sql)) return [{ ok: db.rule.active }];
    if (/action_payload->'suzi'->>'person_id' AS pid/.test(sql)) return db.rule.active ? [{ pid: db.rule.person_id }] : [];
    if (/receipt_pending'\) = 'true'/.test(sql) && /WHERE id = \$1/.test(sql)) {
      const r = db.rows.get(a[0]);
      return r && r.output?.send?.state === 'sending' && r.output.send.receipt_pending === true ? [{ client_number: r.client_number, user_id: r.user_id, mid: r.output.send.gmail_message_id }] : [];
    }
    return [];
  },
} }));
vi.mock('../src/services/auditLogService', () => ({ audit: async () => undefined }));
vi.mock('../src/services/featureFlagService', () => ({ getFlagValue: async () => '' }));
vi.mock('../src/services/suzi/suziPeople', () => ({ personById: async (_c: string, _u: number, id: string) => db.persons.get(id) ?? null }));
vi.mock('../src/services/gmailService', () => ({
  sendGmailDraft: async () => { db.gmailSends++; return { success: true, messageId: `gm${db.gmailSends}` }; },
  sentReceipt: async () => (db.receipts.shift() ?? 'unknown'),
  deleteGmailDraft: async (_u: number, d: string) => { db.deleted.push(d); return { success: true }; },
}));
vi.mock('../src/services/suzi/suziEmail', () => ({
  latestMail: async () => ({ subject: 'Quote', senderEmail: 'v@vendor.com' }),
  forwardEmail: async () => { const id = db.next++; db.rows.set(id, { id, client_number: 'T', user_id: 2, action_type: 'draft_reply', idempotency_key: null, input: {}, output: {}, updated_at: new Date() }); return { ok: true, item: { draft_id: String(id) } }; },
  saveToGmailDrafts: async (_c: string, _u: number, a: any) => { db.drafts.push(a.draft_id); const r = db.rows.get(Number(a.draft_id))!; r.output = { gmailDraftId: `d${a.draft_id}`, send: { state: 'held', send_at: new Date(Date.now() - 1000).toISOString() } }; return { ok: true, item: { sent: true, undo_until: 'x' } }; },
  saveNewDraft: async () => ({ ok: true }), writeWithModel: async () => '',
}));

import { emailDelegate, ruleForwardKey } from '../src/services/suzi/suziDelegate';
import * as delegateMod from '../src/services/suzi/suziDelegate';
import { releaseHeldSend, confirmReceipt, setSendScheduler, resumeHeldSends } from '../src/services/suzi/suziSend';
import { readFileSync } from 'fs';

const timers: Array<{ fn: () => void; ms: number }> = [];
setSendScheduler((fn, ms) => { timers.push({ fn, ms }); });
vi.spyOn(delegateMod, 'afterSuziSent').mockImplementation(async (id: number) => { db.after.push(id); });

const gate = { signatureVerified: false, voiceScore: null, byRule: 'r1' };
const args = (x: any = {}) => ({ email_id: 't1', rule_id: 'r1', person_id: 'p1', message_id: 'm1', ...x });
const user = { id: 2, clientNumber: 'T' };

beforeEach(() => {
  db.rows.clear(); db.next = 100; db.rule = { active: true, person_id: 'p1' }; db.gmailSends = 0; db.receipts = []; db.after = []; db.drafts = []; db.deleted = []; timers.length = 0;
  db.persons = new Map([['p1', { id: 'p1', name: 'Ali', email: 'ali@tmc.com' }], ['p2', { id: 'p2', name: 'Sara', email: 'sara@tmc.com' }]]);
});
void user;

describe('(a) one claim per message', () => {
  it('two ticks racing on one message: one forward, the other stops before Gmail', async () => {
    const [x, y] = await Promise.all([emailDelegate('T', 2, args(), true, gate), emailDelegate('T', 2, args(), true, gate)]);
    const oks = [x, y].filter((r: any) => r.ok); const lost = [x, y].filter((r: any) => !r.ok) as any[];
    expect(oks).toHaveLength(1); expect(lost[0].error).toBe('already_forwarded');
    expect(db.drafts).toHaveLength(1); // only the winner reached Gmail Drafts
    expect([...db.rows.values()].filter((r) => r.idempotency_key)).toHaveLength(1);
    expect([...db.rows.values()].find((r) => !r.idempotency_key)!.output.send).toMatchObject({ state: 'cancelled', error: 'already_forwarded' });
  });
  it('after a restart, the same message to the same person is refused', async () => {
    expect((await emailDelegate('T', 2, args(), true, gate) as any).ok).toBe(true);
    expect(await emailDelegate('T', 2, args(), true, gate)).toMatchObject({ ok: false, error: 'already_forwarded' });
    expect(db.drafts).toHaveLength(1);
  });
  it('two releases of one hold send once', async () => {
    await emailDelegate('T', 2, args(), true, gate); db.receipts = ['sent'];
    const id = [...db.rows.keys()][0];
    await Promise.all([releaseHeldSend(id), releaseHeldSend(id)]);
    expect(db.gmailSends).toBe(1);
  });
  it('the key is per message and per person', () => {
    expect(ruleForwardKey('T', 2, 'm1', 'ALI@tmc.com')).toBe(ruleForwardKey('T', 2, 'm1', 'ali@tmc.com'));
    expect(ruleForwardKey('T', 2, 'm1', 'ali@tmc.com')).not.toBe(ruleForwardKey('T', 2, 'm1', 'sara@tmc.com'));
    expect(ruleForwardKey('T', 2, 'm1', 'ali@tmc.com')).not.toBe(ruleForwardKey('T', 2, 'm2', 'ali@tmc.com'));
  });
});

describe('(b) the person changes during the hold', () => {
  it('the rule now names another person: cancelled, nothing sent, queued again; the new person can be claimed', async () => {
    await emailDelegate('T', 2, args(), true, gate); const id = [...db.rows.keys()][0];
    db.rule.person_id = 'p2';
    expect(await releaseHeldSend(id)).toBe('skipped');
    expect(db.gmailSends).toBe(0);
    expect(db.rows.get(id)!.output.send).toMatchObject({ state: 'cancelled', requeue: true, draft_deleted: true });
    expect(db.deleted).toEqual([`d${id}`]); // Suzi Master 14 Nov: the cancelled forward's draft leaves his Drafts
    const again: any = await emailDelegate('T', 2, args({ person_id: 'p2' }), true, gate);
    expect(again.ok).toBe(true); expect(db.drafts).toHaveLength(2);
  });
  it("the person's email changed: cancelled and queued again", async () => {
    await emailDelegate('T', 2, args(), true, gate); const id = [...db.rows.keys()][0];
    db.persons.set('p1', { id: 'p1', name: 'Ali', email: 'ali.new@tmc.com' });
    expect(await releaseHeldSend(id)).toBe('skipped');
    expect(db.gmailSends).toBe(0); expect(db.rows.get(id)!.output.send.requeue).toBe(true);
  });
  it('the job queues a requeued message again (its NOT EXISTS skips requeue rows)', () => {
    const job = readFileSync('src/jobs/ruleForwardJob.ts', 'utf8');
    expect(job).toMatch(/a\.input->'delegate'->>'message_id' = f\.source_id[\s\S]{0,200}requeue', ''\) <> 'true'/);
  });
});

describe('(c) delivered only after the receipt', () => {
  it("Gmail's id alone: still sending, no task; the SENT label read back: delivered, then the task", async () => {
    await emailDelegate('T', 2, args(), true, gate); const id = [...db.rows.keys()][0];
    db.receipts = ['unknown'];
    await releaseHeldSend(id);
    expect(db.rows.get(id)!.output.send).toMatchObject({ state: 'sending', gmail_message_id: 'gm1', receipt_pending: true });
    expect(db.after).toEqual([]);
    expect(timers.at(-1)!.ms).toBe(15_000); // read again later
    db.receipts = ['sent'];
    expect(await confirmReceipt(id, 1)).toBe('sent');
    expect(db.rows.get(id)!.output.send).toMatchObject({ state: 'sent', receipt_pending: false });
    expect(db.rows.get(id)!.output.send.delivered_at).toBeTruthy();
    expect(db.after).toEqual([id]);
  });
  it('not in Gmail as sent: failed, never delivered, no task', async () => {
    await emailDelegate('T', 2, args(), true, gate); const id = [...db.rows.keys()][0];
    db.receipts = ['not_sent'];
    await releaseHeldSend(id);
    expect(db.rows.get(id)!.output.send.state).toBe('failed'); expect(db.after).toEqual([]);
  });
  it('after the last try it stays sending (never called delivered)', async () => {
    await emailDelegate('T', 2, args(), true, gate); const id = [...db.rows.keys()][0];
    db.receipts = [];
    await releaseHeldSend(id); await confirmReceipt(id, 3);
    expect(db.rows.get(id)!.output.send.state).toBe('sending');
  });
  it('a restart reads a pending receipt again', () => {
    const src = readFileSync('src/services/suzi/suziSend.ts', 'utf8');
    expect(src).toMatch(/resumeHeldSends[\s\S]*receipt_pending'\) = 'true'[\s\S]*confirmReceipt\(p\.id\)/);
    expect(typeof resumeHeldSends).toBe('function');
  });
});

describe('Suzi Master 14 Nov: no silent outcome', () => {
  it('rule removed during the hold: cancelled and its draft deleted', async () => {
    await emailDelegate('T', 2, args(), true, gate); const id = [...db.rows.keys()][0];
    db.rule.active = false;
    await releaseHeldSend(id);
    expect(db.gmailSends).toBe(0); expect(db.rows.get(id)!.output.send).toMatchObject({ state: 'cancelled', draft_deleted: true });
  });
  it('a claim that never reached Gmail is given up after 10 minutes and queued again; failed reaches the pack', () => {
    const job = readFileSync('src/jobs/ruleForwardJob.ts', 'utf8');
    expect(job).toMatch(/idempotency_key \|\| ':void:'[\s\S]{0,600}output->'send'->>'state' IS NULL AND created_at < now\(\) - \(\$3::int/);
    expect(job).toMatch(/await voidStaleClaims\(u\.clientNumber, u\.id\)/);
    const rules = readFileSync('src/services/suzi/suziEmailRules.ts', 'utf8');
    expect(rules).toMatch(/IN \('held', 'sending', 'cancelled', 'failed'\)/);
    expect(rules).toMatch(/r\.st === 'failed' \? 'failed'/);
  });
  it('fence: a hold whose claim was given up never sends; its draft is deleted and the message queued again', async () => {
    await emailDelegate('T', 2, args(), true, gate); const id = [...db.rows.keys()][0];
    db.rows.get(id)!.idempotency_key += `:void:${id}`; // the 10-minute sweep gave the key up
    expect(await releaseHeldSend(id)).toBe('skipped');
    expect(db.gmailSends).toBe(0);
    expect(db.rows.get(id)!.output.send).toMatchObject({ state: 'cancelled', requeue: true, draft_deleted: true });
  });
});
