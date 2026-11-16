/**
 * DEF-488 (outside review, 16 Nov 2026): the charter says a forward carries the email's attachments (F-2.4); the
 * draft was plain text. The Gmail draft is now multipart with each original attachment, decoded back here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({ raw: '', msg: null as any, att: {} as Record<string, string> }));
vi.mock('../src/services/integrationService', () => ({ getAuthenticatedClient: async () => ({ client: {} }) }));
vi.mock('googleapis', () => ({ google: { gmail: () => ({ users: {
  drafts: { create: async (a: any) => { s.raw = a.requestBody.message.raw; return { data: { id: 'd1' } }; } },
  messages: {
    get: async () => ({ data: s.msg }),
    attachments: { get: async ({ id }: any) => ({ data: { data: s.att[id] } }) },
  },
} }) } }));
import { createGmailDraft, attachmentsOf } from '../src/services/gmailService';

const b64url = (t: string) => Buffer.from(t).toString('base64url');
beforeEach(() => {
  s.raw = '';
  s.att = { A1: b64url('%PDF-1.4 quote') };
  s.msg = { payload: { mimeType: 'multipart/mixed', parts: [
    { mimeType: 'text/plain', body: { data: b64url('see attached') } },
    { mimeType: 'application/pdf', filename: 'Quote.pdf', body: { attachmentId: 'A1', size: 14 } },
    { mimeType: 'text/csv', filename: 'rates.csv', body: { data: b64url('a,b\n1,2') } },
  ] } };
});

describe('DEF-488 a forward carries the attachments', () => {
  it('reads every attachment of the original, by id or inline', async () => {
    const r = await attachmentsOf(2, 'm1');
    expect(r.left_out).toBe(0);
    expect(r.files.map((f) => [f.filename, f.mimeType, Buffer.from(f.data, 'base64').toString()])).toEqual([
      ['Quote.pdf', 'application/pdf', '%PDF-1.4 quote'], ['rates.csv', 'text/csv', 'a,b\n1,2'],
    ]);
  });
  it('the draft is multipart: the text, then each file, intact', async () => {
    const { files } = await attachmentsOf(2, 'm1');
    expect((await createGmailDraft(2, 'ali@x.com', 'Fwd: Quote', 'FYI', undefined, { attachments: files })).success).toBe(true);
    const mime = Buffer.from(s.raw, 'base64url').toString();
    expect(mime).toMatch(/Content-Type: multipart\/mixed; boundary="nexeo_/);
    expect(mime).toContain('Content-Disposition: attachment; filename="Quote.pdf"');
    const b64 = mime.split('filename="Quote.pdf"')[1].split('\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, '');
    expect(Buffer.from(b64, 'base64').toString()).toBe('%PDF-1.4 quote');
    expect(mime).toContain('\r\n\r\nFYI\r\n');
  });
  it('no attachments: the plain draft as before', async () => {
    await createGmailDraft(2, 'ali@x.com', 'Hi', 'text');
    const mime = Buffer.from(s.raw, 'base64url').toString();
    expect(mime).toContain('Content-Type: text/plain; charset=utf-8');
    expect(mime).not.toContain('multipart');
  });
});
