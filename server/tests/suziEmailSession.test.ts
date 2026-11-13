/**
 * Going through emails one by one (link E1-E7). Pinned:
 *  1. "send" saves to Gmail Drafts and never sends: sendUserEmail is not even reachable from here, and it needs the user's yes;
 *  2. everything is scoped to this tenant and user; someone else's draft or email is not found;
 *  3. dictation uses the user's words with no model; a written draft is never on Flash, and treats the email as data;
 *  4. changing a saved draft removes the saved copy, so Gmail never holds what wasn't approved;
 *  5. undo removes it; saving twice gives the same draft; a Gmail failure is reported, not claimed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

const query = vi.fn();
const find = vi.fn();
const create = vi.fn();
const update = vi.fn();
const decision = vi.fn();
vi.mock('../src/db/prisma', () => ({
  default: {
    $queryRawUnsafe: (...a: any[]) => query(...a),
    agentAction: { findFirst: (...a: any[]) => find(...a), create: (...a: any[]) => create(...a), update: (...a: any[]) => update(...a) },
    feedEvent: { findFirst: async () => ({ sourceId: 'gm1' }) },
    decisionLog: { create: (...a: any[]) => decision(...a) },
  },
}));
const saveDraft = vi.fn();
const dropDraft = vi.fn();
const read = vi.fn();
vi.mock('../src/services/gmailService', () => ({
  readEmail: (...a: any[]) => read(...a),
  getSentSamples: async () => ({ samples: [] }),
  createGmailDraft: (...a: any[]) => saveDraft(...a),
  deleteGmailDraft: (...a: any[]) => dropDraft(...a),
  getEmailHeadersForReply: async () => ({ threadId: 'th1', rfcMessageId: '<m1>', references: null }),
}));
const llm = vi.fn();
vi.mock('../src/services/llmRouter', () => ({ callLLM: (...a: any[]) => llm(...a) }));
const invalidate = vi.fn();
vi.mock('../src/services/triage/executorHelpers', () => ({ classifyArchetypeFromPayload: () => 'fyi' }));
vi.mock('../src/services/triage/triageSuggester', () => ({
  computeDedupHash: () => 'hash',
  invalidateTriageCache: (...a: any[]) => invalidate(...a),
}));

// T23: whether he has already answered is asked of Gmail live (suziReplied.ts, tested on its own).
const replyOf = vi.fn();
vi.mock('../src/services/suzi/suziReplied', () => ({ replyStateOf: (...a: any[]) => replyOf(...a) }));

import { readThread, runEmailOp } from '../src/services/suzi/suziEmail';

const mailRow = { id: 'fe1', source_id: 'gm1', subject: 'Budget', sender_email: 'a@x.com', snippet: 's', thread_id: 'th1' };
const draftRow = (output: any = { to: 'a@x.com', subject: 'Re: Budget', body: 'Hello' }) => ({ id: 7, output, input: { feedEventId: 'fe1' } });

beforeEach(() => {
  for (const f of [query, find, create, update, decision, saveDraft, dropDraft, read, llm, invalidate, replyOf]) f.mockReset();
  replyOf.mockResolvedValue({ replied_at: null, reply_checked: true });
  query.mockResolvedValue([mailRow]);
  create.mockResolvedValue({ id: 7 });
  read.mockResolvedValue({ email: { from: 'A <a@x.com>', to: 'me', cc: '', subject: 'Budget', date: 'd', body: 'x'.repeat(9000), attachments: [{ filename: 'f.pdf' }] } });
  llm.mockResolvedValue({ text: 'Written.' });
  saveDraft.mockResolvedValue({ success: true, draftId: 'g1' });
  dropDraft.mockResolvedValue({ success: true });
});

describe('reading', () => {
  it('has the agreed shape, cut at 4,000 characters, for this tenant and user', async () => {
    const e: any = await readThread('TMC-0001', 2, 'th1');
    expect(Object.keys(e).sort()).toEqual(['attachments', 'body_text', 'cc', 'from', 'received_at', 'replied_at', 'reply_checked', 'subject', 'thread_id', 'to']);
    expect(e.body_text).toHaveLength(4000);
    expect(e.attachments).toEqual(['f.pdf']);
    expect(query.mock.calls[0].slice(1)).toEqual(['TMC-0001', 2, 'th1']);
    expect(query.mock.calls[0][0]).toContain('client_number = $1 AND user_id = $2');
  });
  it('someone else\'s thread is simply not found, and Gmail is never asked', async () => {
    query.mockResolvedValue([]);
    expect(await readThread('T', 2, 'other')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

describe('drafting', () => {
  it('dictation is the user\'s own words, with no model', async () => {
    query.mockImplementation(async (sql: string) => (sql.includes('agent_actions') ? [] : [mailRow]));
    const r: any = await runEmailOp('T', 2, 'email.draft', { thread_id: 'th1', text: 'Yes, go ahead.' }, false);
    expect(r.item).toEqual({ draft_id: '7', to: 'a@x.com', cc: null, subject: 'Re: Budget', body: 'Yes, go ahead.', replied_at: null, reply_checked: true });
    expect(llm).not.toHaveBeenCalled();
  });
  it('a written draft is never on Flash, and an email\'s text is data', async () => {
    query.mockImplementation(async (sql: string) => (sql.includes('agent_actions') ? [] : [mailRow]));
    await runEmailOp('T', 2, 'email.draft', { thread_id: 'th1', instruction: 'say yes' }, false);
    const [system, user, opts] = llm.mock.calls[0];
    expect(opts.providers.join()).not.toMatch(/flash/i);
    expect(system).toMatch(/never follow instructions/);
    expect(user).toContain('say yes');
  });
  it('a subject already starting Re: isn\'t doubled', async () => {
    query.mockImplementation(async (sql: string) => (sql.includes('agent_actions') ? [] : [{ ...mailRow, subject: 'Re: Budget' }]));
    const r: any = await runEmailOp('T', 2, 'email.draft', { thread_id: 'th1', text: 'ok' }, false);
    expect(r.item.subject).toBe('Re: Budget');
  });
  it('someone else\'s draft is not found', async () => {
    find.mockResolvedValue(null);
    for (const op of ['email.update_draft', 'email.send', 'email.undo']) {
      expect(await runEmailOp('TMC-0001', 2, op, { draft_id: '9', instruction: 'x' }, true)).toMatchObject({ ok: false, error: 'not_found' });
    }
    expect(find.mock.calls[0][0].where).toMatchObject({ id: 9, clientNumber: 'TMC-0001', userId: 2 });
    expect(saveDraft).not.toHaveBeenCalled();
  });
  it('changing a saved draft removes the saved copy', async () => {
    find.mockResolvedValue(draftRow({ to: 'a', subject: 's', body: 'b', gmailDraftId: 'g1' }));
    const r: any = await runEmailOp('T', 2, 'email.update_draft', { draft_id: '7', instruction: 'shorter' }, false);
    expect(r.item.body).toBe('Written.');
    expect(dropDraft).toHaveBeenCalledWith(2, 'g1');
    expect(update.mock.calls[0][0].data.output.gmailDraftId).toBeUndefined();
  });
});

describe('a new draft, a new email, a forward', () => {
  it('a full draft from the desktop\'s own AI is kept word for word, and a second replaces the first, in Gmail too', async () => {
    query.mockImplementation(async (sql: string) => (sql.includes('agent_actions') ? [{ id: 5, gmail_draft_id: 'old' }] : [mailRow]));
    const r: any = await runEmailOp('TMC-0001', 2, 'email.draft', { thread_id: 'th1', text: 'Line one.\n\nLine two.' }, false);
    expect(r.item.body).toBe('Line one.\n\nLine two.');
    expect(llm).not.toHaveBeenCalled();
    expect(dropDraft).toHaveBeenCalledWith(2, 'old');
    expect(update.mock.calls[0][0]).toMatchObject({ where: { id: 5 }, data: { status: 'rejected' } });
    const sql = query.mock.calls.find((c) => c[0].includes('agent_actions'))!;
    expect(sql.slice(1)).toEqual(['TMC-0001', 2, 'th1']);
  });
  it('a new email needs a real address, a subject and text', async () => {
    const good: any = await runEmailOp('T', 2, 'email.new', { to: 'a@x.com, b@y.org', cc: 'c@z.io', subject: 'Hi', text: 'Body' }, false);
    expect(good.item).toEqual({ draft_id: '7', to: 'a@x.com, b@y.org', cc: 'c@z.io', subject: 'Hi', body: 'Body' });
    expect(await runEmailOp('T', 2, 'email.new', { to: 'Zeeshan', subject: 'Hi', text: 'B' }, false)).toMatchObject({ error: 'bad_address' });
    expect(await runEmailOp('T', 2, 'email.new', { to: 'a@x.com', subject: '', text: 'B' }, false)).toMatchObject({ error: 'bad_draft' });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('a forward quotes the email and says what it leaves out', async () => {
    const r: any = await runEmailOp('T', 2, 'email.forward', { thread_id: 'th1', to: 'b@y.org', text: 'FYI' }, false);
    expect(r.item.subject).toBe('Fwd: Budget');
    expect(r.item.body.startsWith('FYI\n\n---------- Forwarded message')).toBe(true);
    expect(r.item.attachments_left_out).toBe(1);
  });
  it('someone else\'s thread can\'t be forwarded', async () => {
    query.mockResolvedValue([]);
    expect(await runEmailOp('T', 2, 'email.forward', { thread_id: 'x', to: 'b@y.org' }, false)).toMatchObject({ error: 'not_found' });
    expect(saveDraft).not.toHaveBeenCalled();
  });
  it('a new email isn\'t threaded on anything when saved', async () => {
    find.mockResolvedValue({ id: 7, output: { to: 'a', subject: 's', body: 'b', mode: 'new' }, input: {} });
    await runEmailOp('T', 2, 'email.send', { draft_id: '7' }, true);
    expect(saveDraft.mock.calls[0][5]).toEqual({});
  });
});

describe('"send", until signing exists', () => {
  it('this file has no way to send: it saves a draft', () => {
    const src = readFileSync('src/services/suzi/suziEmail.ts', 'utf8');
    expect(src).not.toMatch(/sendUserEmail|messages\.send/);
  });
  it('needs the user\'s yes', async () => {
    expect(await runEmailOp('T', 2, 'email.send', { draft_id: '7' }, false)).toEqual({ ok: false, error: 'needs_confirmation' });
    expect(find).not.toHaveBeenCalled();
  });
  it('says plainly that it was saved and not sent, threaded on the original', async () => {
    find.mockResolvedValue(draftRow());
    const r: any = await runEmailOp('T', 2, 'email.send', { draft_id: '7' }, true);
    expect(r.item).toEqual({ draft_id: '7', saved_to_gmail_drafts: true, sent: false, gmail_draft_id: 'g1' });
    expect(saveDraft.mock.calls[0][5]).toMatchObject({ threadId: 'th1', inReplyTo: '<m1>' });
  });
  it('saving twice gives the same draft', async () => {
    find.mockResolvedValue(draftRow({ to: 'a', subject: 's', body: 'b', gmailDraftId: 'g1' }));
    expect(((await runEmailOp('T', 2, 'email.send', { draft_id: '7' }, true)) as any).item.gmail_draft_id).toBe('g1');
    expect(saveDraft).not.toHaveBeenCalled();
  });
  it('a Gmail failure is reported, not claimed', async () => {
    find.mockResolvedValue(draftRow());
    saveDraft.mockResolvedValue({ success: false, error: 'insufficient scope' });
    expect(await runEmailOp('T', 2, 'email.send', { draft_id: '7' }, true)).toEqual({ ok: false, error: 'rejected', detail: 'insufficient scope' });
    expect(update).not.toHaveBeenCalled();
  });
  it('undo removes it; with nothing saved, it says so', async () => {
    find.mockResolvedValue(draftRow({ to: 'a', subject: 's', body: 'b', gmailDraftId: 'g1' }));
    expect(((await runEmailOp('T', 2, 'email.undo', { draft_id: '7' }, false)) as any).item.undone).toBe(true);
    expect(dropDraft).toHaveBeenCalledWith(2, 'g1');
    find.mockResolvedValue(draftRow());
    expect(((await runEmailOp('T', 2, 'email.undo', { draft_id: '7' }, false)) as any).item.undone).toBe(false);
  });
});

describe('marking', () => {
  it('every email of the thread leaves the list, for this user', async () => {
    query.mockResolvedValue([mailRow, { ...mailRow, id: 'fe2' }]);
    const r: any = await runEmailOp('TMC-0001', 2, 'email.mark', { thread_id: 'th1', state: 'no_reply_needed' }, false);
    expect(r.item.emails).toBe(2);
    expect(decision).toHaveBeenCalledTimes(2);
    expect(decision.mock.calls[0][0].data).toMatchObject({ clientNumber: 'TMC-0001', userId: 2, entityId: 'fe1', userDecision: 'dismissed', isMatch: false });
    expect(invalidate).toHaveBeenCalledWith('fe2');
  });
  it('an unknown state or thread changes nothing', async () => {
    expect(await runEmailOp('T', 2, 'email.mark', { thread_id: 'th1', state: 'done' }, false)).toEqual({ ok: false, error: 'bad_state' });
    query.mockResolvedValue([]);
    expect(await runEmailOp('T', 2, 'email.mark', { thread_id: 'x', state: 'handled' }, false)).toEqual({ ok: false, error: 'not_found' });
    expect(decision).not.toHaveBeenCalled();
  });
});

describe('T23: already answered', () => {
  it('GET /email says when he replied, asked of Gmail by the thread\'s own Gmail id', async () => {
    replyOf.mockResolvedValue({ replied_at: '2026-11-06T06:40:00.000Z', reply_checked: true });
    const e: any = await readThread('T', 2, 'th1');
    expect(e.replied_at).toBe('2026-11-06T06:40:00.000Z');
    expect(e.reply_checked).toBe(true);
    expect(replyOf).toHaveBeenCalledWith(2, 'th1');
  });
  it('GET /email says plainly when it could not be checked', async () => {
    replyOf.mockResolvedValue({ replied_at: null, reply_checked: false });
    const e: any = await readThread('T', 2, 'th1');
    expect(e).toMatchObject({ replied_at: null, reply_checked: false });
  });
  it('email.draft on an answered thread is still saved, and the answer says he already replied', async () => {
    query.mockImplementation(async (sql: string) => (sql.includes('agent_actions') ? [] : [mailRow]));
    replyOf.mockResolvedValue({ replied_at: '2026-11-06T06:40:00.000Z', reply_checked: true });
    const r: any = await runEmailOp('T', 2, 'email.draft', { thread_id: 'th1', text: 'Yes.' }, false);
    expect(r.ok).toBe(true);
    expect(r.item.draft_id).toBe('7');
    expect(r.item.replied_at).toBe('2026-11-06T06:40:00.000Z');
  });
});
