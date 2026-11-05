/**
 * DEF-401, 5 Nov: an email with attachments read as empty, 5 of 10 in the founder's real attention list, because its text
 * sits a level or two down and only the top level was searched.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/db/prisma', () => ({ default: {} }));
import { extractEmailBody } from '../src/services/gmailService';

const b64 = (t: string) => Buffer.from(t).toString('base64');
const text = (t: string, mimeType = 'text/plain') => ({ mimeType, body: { data: b64(t) } });

describe('the text of an email', () => {
  it('a simple message', () => {
    expect(extractEmailBody(text('Hello'))).toBe('Hello');
  });
  it('with attachments: mixed around alternative around the text', () => {
    const payload = { mimeType: 'multipart/mixed', parts: [
      { mimeType: 'multipart/alternative', parts: [text('Plain words'), text('<p>Html words</p>', 'text/html')] },
      { mimeType: 'application/pdf', filename: 'a.pdf', body: { size: 9 } },
    ] };
    expect(extractEmailBody(payload)).toBe('Plain words');
  });
  it('deeper still: related inside alternative', () => {
    const payload = { mimeType: 'multipart/mixed', parts: [{ mimeType: 'multipart/related', parts: [{ mimeType: 'multipart/alternative', parts: [text('<div>Deep &nbsp;words</div><style>x{}</style>', 'text/html')] }] }] };
    expect(extractEmailBody(payload)).toBe('Deep words');
  });
  it('an attached text file is not the email', () => {
    const payload = { mimeType: 'multipart/mixed', parts: [{ ...text('from the file'), filename: 'notes.txt' }, text('The email')] };
    expect(extractEmailBody(payload)).toBe('The email');
  });
  it('nothing readable is empty, not an error', () => {
    expect(extractEmailBody({ mimeType: 'multipart/mixed', parts: [] })).toBe('');
    expect(extractEmailBody(undefined)).toBe('');
  });
});
