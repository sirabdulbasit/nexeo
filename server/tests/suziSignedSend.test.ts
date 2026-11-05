/**
 * Link T22 (both AGREE, 6 Nov 2026): really sending a Suzi email. Pinned:
 *  GATE      a send goes out only when signed (as verified by Suzi's server), confirmed, with a voice score,
 *            for a user on the switch; any one missing and it is saved to Drafts, `sent: false`, as before;
 *  HOLD      a real send is held 10 seconds: nothing reaches Gmail until the timer, and asking again doesn't
 *            start a second hold;
 *  UNDO      inside the hold, one conditional write cancels it (scoped to tenant and user) and it stays in
 *            Drafts; once claimed for sending, undo says it has gone;
 *  RELEASE   only a held, due send is claimed; Gmail sends the saved draft itself; failure is recorded, not
 *            claimed; a hold found minutes late is not sent;
 *  NO OTHER WAY  suziEmail.ts still has no send call; only suziSend.ts sends, and only through the claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

const query = vi.fn();
const exec = vi.fn();
const find = vi.fn();
const update = vi.fn();
vi.mock('../src/db/prisma', () => ({
  default: {
    $queryRawUnsafe: (...a: any[]) => query(...a),
    $executeRawUnsafe: (...a: any[]) => exec(...a),
    agentAction: { findFirst: (...a: any[]) => find(...a), update: (...a: any[]) => update(...a) },
    feedEvent: { findFirst: async () => ({ sourceId: 'gm1' }) },
  },
}));
const saveDraft = vi.fn();
const sendDraft = vi.fn();
vi.mock('../src/services/gmailService', () => ({
  createGmailDraft: (...a: any[]) => saveDraft(...a),
  sendGmailDraft: (...a: any[]) => sendDraft(...a),
  deleteGmailDraft: async () => ({ success: true }),
  getEmailHeadersForReply: async () => ({ threadId: 'th1', rfcMessageId: '<m1>', references: null }),
}));
const flag = vi.fn();
vi.mock('../src/services/featureFlagService', () => ({ getFlagValue: (...a: any[]) => flag(...a) }));
const auditFn = vi.fn();
vi.mock('../src/services/auditLogService', () => ({ audit: (...a: any[]) => auditFn(...a) }));
vi.mock('../src/services/llmRouter', () => ({ callLLM: async () => ({ text: 'x' }) }));

import { runEmailOp } from '../src/services/suzi/suziEmail';
import { releaseHeldSend, resumeHeldSends, setSendScheduler, SEND_HOLD_MS, SEND_SWITCH, LATE_LIMIT_MS } from '../src/services/suzi/suziSend';

const timers: Array<{ fn: () => void; ms: number }> = [];
setSendScheduler((fn, ms) => { timers.push({ fn, ms }); });

const draft = (output: any = { to: 'a@x.com', subject: 'Re: Budget', body: 'Hello' }) => ({ id: 7, output, input: { feedEventId: 'fe1' } });
const SIGNED = { signatureVerified: true, voiceScore: 0.92 };

beforeEach(() => {
  for (const f of [query, exec, find, update, saveDraft, sendDraft, flag, auditFn]) f.mockReset();
  timers.length = 0;
  saveDraft.mockResolvedValue({ success: true, draftId: 'g1' });
  flag.mockResolvedValue('3, 2');
  find.mockResolvedValue(draft());
});

describe('the gate', () => {
  it('signed, confirmed, voiced, on the switch: held for 10 seconds, nothing sent yet', async () => {
    const before = Date.now();
    const r: any = await runEmailOp('T', 2, 'email.send', { draft_id: '7' }, true, SIGNED);
    expect(r.ok).toBe(true);
    expect(r.item).toMatchObject({ draft_id: '7', saved_to_gmail_drafts: true, sent: true, gmail_draft_id: 'g1' });
    const at = new Date(r.item.send_at).getTime();
    expect(at - before).toBeGreaterThanOrEqual(SEND_HOLD_MS);
    expect(r.item.undo_until).toBe(r.item.send_at);
    expect(flag).toHaveBeenCalledWith('T', SEND_SWITCH, '');
    const written = update.mock.calls.at(-1)![0].data.output;
    expect(written.send).toMatchObject({ state: 'held', voice_score: 0.92 });
    expect(written.gmailDraftId).toBe('g1');
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBeGreaterThanOrEqual(SEND_HOLD_MS);
    expect(sendDraft).not.toHaveBeenCalled();
  });
  it('unsigned, even for a user on the switch: saved to Drafts, not sent', async () => {
    const r: any = await runEmailOp('T', 2, 'email.send', { draft_id: '7' }, true, { signatureVerified: false, voiceScore: 0.92 });
    expect(r.item).toEqual({ draft_id: '7', saved_to_gmail_drafts: true, sent: false, gmail_draft_id: 'g1' });
    expect(timers).toHaveLength(0);
  });
  it('signed, but the user is not on the switch (12 is not 2): not sent', async () => {
    flag.mockResolvedValue('12,23');
    const r: any = await runEmailOp('T', 2, 'email.send', { draft_id: '7' }, true, SIGNED);
    expect(r.item.sent).toBe(false);
    expect(timers).toHaveLength(0);
  });
  it('the switch is empty by default', async () => {
    flag.mockResolvedValue('');
    expect(((await runEmailOp('T', 2, 'email.send', { draft_id: '7' }, true, SIGNED)) as any).item.sent).toBe(false);
  });
  it('signed without a voice score: refused, nothing saved', async () => {
    expect(await runEmailOp('T', 2, 'email.send', { draft_id: '7' }, true, { signatureVerified: true, voiceScore: null }))
      .toEqual({ ok: false, error: 'no_voice_score', detail: 'a signed send needs voice_score' });
    expect(saveDraft).not.toHaveBeenCalled();
  });
  it('without the user\'s yes: refused, signed or not', async () => {
    expect(await runEmailOp('T', 2, 'email.send', { draft_id: '7' }, false, SIGNED)).toEqual({ ok: false, error: 'needs_confirmation' });
  });
  it('asking again while held gives the same hold, not a second one', async () => {
    find.mockResolvedValue(draft({ to: 'a', subject: 's', body: 'b', gmailDraftId: 'g1', send: { state: 'held', send_at: 'T1', undo_until: 'T1' } }));
    const r: any = await runEmailOp('T', 2, 'email.send', { draft_id: '7' }, true, SIGNED);
    expect(r.item).toMatchObject({ sent: true, send_at: 'T1' });
    expect(timers).toHaveLength(0);
    expect(update).not.toHaveBeenCalled();
  });
  it('a held draft can\'t be rewritten', async () => {
    find.mockResolvedValue(draft({ to: 'a', subject: 's', body: 'b', send: { state: 'held' } }));
    expect(await runEmailOp('T', 2, 'email.update_draft', { draft_id: '7', instruction: 'shorter' }, false))
      .toEqual({ ok: false, error: 'bad_state', detail: 'it is being sent or has gone' });
  });
  it('a newer draft for the thread never drops one being sent', () => {
    const src = readFileSync('src/services/suzi/suziEmail.ts', 'utf8');
    expect(src).toContain("NOT IN ('held', 'sending', 'sent')");
  });
});

describe('undo', () => {
  const held = () => draft({ to: 'a', subject: 's', body: 'b', gmailDraftId: 'g1', send: { state: 'held' } });
  it('inside the hold: cancelled in one conditional write for this tenant and user, and it stays in Drafts', async () => {
    find.mockResolvedValue(held());
    query.mockResolvedValue([{ id: 7 }]);
    const r: any = await runEmailOp('T', 2, 'email.undo', { draft_id: '7' }, false);
    expect(r.item).toEqual({ draft_id: '7', undone: true, sent: false, saved_to_gmail_drafts: true });
    const [sql, ...params] = query.mock.calls[0];
    expect(sql).toContain("output->'send'->>'state' = 'held'");
    expect(sql).toContain('client_number = $2 AND user_id = $3');
    expect(params).toEqual([7, 'T', 2]);
  });
  it('lost the race to the release: it has gone, and says so', async () => {
    find.mockResolvedValue(held());
    query.mockResolvedValue([]);
    expect(await runEmailOp('T', 2, 'email.undo', { draft_id: '7' }, false)).toEqual({ ok: false, error: 'bad_state', detail: 'it has already gone' });
  });
  it('after it was sent: it has gone', async () => {
    find.mockResolvedValue(draft({ to: 'a', subject: 's', body: 'b', send: { state: 'sent' } }));
    query.mockResolvedValue([]);
    expect(((await runEmailOp('T', 2, 'email.undo', { draft_id: '7' }, false)) as any).error).toBe('bad_state');
  });
  it('a second undo of a cancelled send changes nothing and keeps the draft', async () => {
    find.mockResolvedValue(draft({ to: 'a', subject: 's', body: 'b', gmailDraftId: 'g1', send: { state: 'cancelled' } }));
    expect(((await runEmailOp('T', 2, 'email.undo', { draft_id: '7' }, false)) as any).item.undone).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('release', () => {
  const now = new Date('2026-11-06T00:00:20Z');
  const claimed = (sendAt = '2026-11-06T00:00:10Z', gmail: string | null = 'g1') => [{ client_number: 'T', user_id: 2, gmail_draft_id: gmail, send_at: new Date(sendAt) }];
  it('claims only a held, due send, then Gmail sends the saved draft', async () => {
    query.mockResolvedValue(claimed());
    sendDraft.mockResolvedValue({ success: true, messageId: 'm9' });
    expect(await releaseHeldSend(7, now)).toBe('sent');
    const [sql, id, at] = query.mock.calls[0];
    expect(sql).toContain("output->'send'->>'state' = 'held'");
    expect(sql).toContain("<= $2");
    expect([id, at]).toEqual([7, now]);
    expect(sendDraft).toHaveBeenCalledWith(2, 'g1');
    expect(JSON.parse(exec.mock.calls[0][2])).toMatchObject({ state: 'sent', gmail_message_id: 'm9' });
    expect(auditFn.mock.calls[0][0]).toMatchObject({ clientNumber: 'T', actorId: 2, action: 'suzi.email.sent', result: 'success' });
  });
  it('nothing to claim (undone, or not yet due): nothing is sent', async () => {
    query.mockResolvedValue([]);
    expect(await releaseHeldSend(7, now)).toBe('skipped');
    expect(sendDraft).not.toHaveBeenCalled();
  });
  it('a Gmail failure is recorded as failed, not claimed as sent', async () => {
    query.mockResolvedValue(claimed());
    sendDraft.mockResolvedValue({ success: false, error: 'insufficient scope' });
    expect(await releaseHeldSend(7, now)).toBe('failed');
    expect(JSON.parse(exec.mock.calls[0][2])).toMatchObject({ state: 'failed', error: 'insufficient scope' });
    expect(auditFn.mock.calls[0][0]).toMatchObject({ action: 'suzi.email.send_failed', result: 'failure' });
  });
  it('found more than ten minutes late (the server was down): not sent', async () => {
    query.mockResolvedValue(claimed(new Date(now.getTime() - LATE_LIMIT_MS - 1000).toISOString()));
    expect(await releaseHeldSend(7, now)).toBe('late');
    expect(sendDraft).not.toHaveBeenCalled();
    expect(JSON.parse(exec.mock.calls[0][2]).state).toBe('failed');
  });
  it('at boot every waiting hold gets its timer back', async () => {
    query.mockResolvedValue([{ id: 7, send_at: new Date(now.getTime() + 4000) }, { id: 8, send_at: new Date(now.getTime() - 3000) }]);
    expect(await resumeHeldSends(now)).toBe(2);
    expect(timers.map((t) => t.ms)).toEqual([4250, 250]);
  });
});

describe('no other way to send', () => {
  it('suziEmail.ts has no send call; only suziSend.ts sends, after the claim', () => {
    const email = readFileSync('src/services/suzi/suziEmail.ts', 'utf8');
    expect(email).not.toMatch(/sendUserEmail|messages\.send|drafts\.send|sendGmailDraft/);
    const send = readFileSync('src/services/suzi/suziSend.ts', 'utf8');
    expect(send.indexOf('sendGmailDraft(')).toBeGreaterThan(send.indexOf("'\"sending\"'"));
  });
});
