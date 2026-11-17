/**
 * T32 (both AGREE 17 Nov 2026; founder by voice 12:02:08): Suzi reads his Drafts. One list of Suzi's drafts and his own
 * Gmail drafts; open one (body); a "g:" draft is taken into Nexeo's record on first change/send (same Gmail draft id);
 * discard is confirmed, unsigned; a Gmail read that fails is an error, never an empty list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({ gmail: null as any, mine: [] as any[], created: [] as any[], deleted: [] as string[], exec: [] as any[], one: null as any }));
vi.mock('../src/db/prisma', () => ({ default: {
  $queryRawUnsafe: async (sql: string, ..._a: any[]) => (/output->>'gmailDraftId' = \$3/.test(sql) ? [] : s.mine),
  $executeRawUnsafe: async (...a: any[]) => { s.exec.push(a); return 1; },
  agentAction: { create: async ({ data }: any) => { s.created.push(data); return { id: 77, ...data }; }, findFirst: async () => s.one },
} }));
vi.mock('../src/services/gmailService', () => ({
  listGmailDrafts: async () => s.gmail,
  getGmailDraft: async (_u: number, id: string) => ({ gmailDraftId: id, threadId: 't5', to: 'a@x.com, b@x.com', cc: '', subject: 'Budget', snippet: 'hi', updatedAt: '2026-11-17T05:59:40.000Z', body: 'Full text' }),
  deleteGmailDraft: async (_u: number, id: string) => { s.deleted.push(id); return { success: id !== 'gone' }; },
}));
import { listDrafts, openDraft, adoptGmailDraft, discardDraft } from '../src/services/suzi/suziDrafts';

beforeEach(() => {
  s.gmail = { total: 2, drafts: [
    { gmailDraftId: 'G1', threadId: 't1', to: 'ali@x.com', cc: '', subject: 'Quote', snippet: 'Please see', updatedAt: '2026-11-17T05:59:09.000Z' },
    { gmailDraftId: 'G2', threadId: null, to: 'b@x.com', cc: 'c@x.com', subject: '', snippet: 'his own', updatedAt: '2026-11-17T06:10:00.000Z' },
  ] };
  s.mine = [{ id: 41, o: { gmailDraftId: 'G1', to: 'ali@x.com', subject: 'Quote', body: 'x' }, updated_at: new Date() }];
  s.created = []; s.deleted = []; s.exec = []; s.one = null;
});

describe('T32 drafts', () => {
  it('one list: Suzi-made (her id) and his own (g:<id>), newest first, agreed row', async () => {
    const r = await listDrafts('T', 2);
    expect(r!.drafts.map((d) => [d.draft_id, d.made_by])).toEqual([['g:G2', 'user'], ['41', 'suzi']]);
    expect(r!.drafts[0]).toMatchObject({ gmail_draft_id: 'G2', to: ['b@x.com'], cc: ['c@x.com'], subject: '(no subject)', preview: 'his own' });
    expect(r!.total).toBe(2);
  });
  it('Gmail unreadable → null (an error), never an empty list', async () => {
    s.gmail = null;
    expect(await listDrafts('T', 2)).toBeNull();
  });
  it('open his own draft: the body', async () => {
    expect(await openDraft('T', 2, 'g:G2')).toMatchObject({ ok: true, item: { draft_id: 'g:G2', body: 'Full text', made_by: 'user', to: ['a@x.com', 'b@x.com'] } });
  });
  it('his draft is taken in once, keeping its Gmail draft id (so send uses that same draft)', async () => {
    expect(await adoptGmailDraft('T', 2, 'g:G2')).toBe('77');
    expect(s.created[0].output).toMatchObject({ gmailDraftId: 'G2', subject: 'Budget', body: 'Full text', to: 'a@x.com, b@x.com' });
    expect(await adoptGmailDraft('T', 2, '41')).toBe('41');
  });
  it('discard: confirmed only; his own → removed from Gmail; gone → not_found', async () => {
    expect(await discardDraft('T', 2, 'g:G2', false)).toMatchObject({ ok: false, error: 'needs_confirmation' });
    expect(await discardDraft('T', 2, 'g:G2', true)).toEqual({ ok: true, item: { draft_id: 'g:G2', discarded: true } });
    expect(s.deleted).toEqual(['G2']);
    expect(await discardDraft('T', 2, 'g:gone', true)).toMatchObject({ ok: false, error: 'not_found' });
  });
  it('discard a Suzi draft: its Gmail draft removed, the record marked discarded; a sent one refused', async () => {
    s.one = { id: 41, output: { gmailDraftId: 'G1' } };
    expect(await discardDraft('T', 2, '41', true)).toMatchObject({ ok: true });
    expect(s.deleted).toEqual(['G1']);
    expect(String(s.exec[0][0])).toContain("'discarded', true");
    s.one = { id: 42, output: { send: { state: 'sent' } } };
    expect(await discardDraft('T', 2, '42', true)).toMatchObject({ ok: false, error: 'bad_state' });
  });
});
