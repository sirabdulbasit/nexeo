/**
 * Wiki intake — how each fetched item becomes a source (docs/Wiki-Knowledge.md §0.1.2).
 * `sourceFromFeedItem` is pure; the store behind it is exercised on the real database.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {}, prisma: {} }));

import { sourceFromFeedItem, type FeedItem } from '../src/services/wiki/wikiIntake';
import { sourceId } from '../src/services/wiki/wikiSources';
import { emailPageText } from '../src/services/wiki/wikiBackfill';

const item = (sourceType: string, payload: Record<string, any>, sourceId = 'sid'): FeedItem =>
  ({ id: 'fe1', clientNumber: 'T-1', userId: 2, sourceType, sourceId, payload, at: new Date('2026-11-13T05:00:00Z') });

describe('wikiIntake', () => {
  it('an email lands with its message id, thread, people and a preview that fuller text may replace', () => {
    const s = sourceFromFeedItem(item('gmail', {
      messageId: 'm1', threadId: 't1', subject: 'Pricing', snippet: 'Hi…', from: 'Ali <ali@x.com>', to: 'b@y.com, c@y.com', cc: '', labels: ['INBOX'],
    }))!;
    expect(s).toMatchObject({ kind: 'email', externalId: 'm1', threadKey: 't1', title: 'Pricing', body: 'Hi…', preview: true, feedEventId: 'fe1' });
    expect(s.participants).toEqual(['Ali <ali@x.com>', 'b@y.com', 'c@y.com']);
    expect(s.details).toMatchObject({ labels: ['INBOX'], from: 'Ali <ali@x.com>' });
  });

  it('a calendar entry is one source per occurrence, timed at its start', () => {
    const s = sourceFromFeedItem(item('gcal', { eventId: 'e1', start: '2026-11-14T10:00:00+05:00', title: 'Sync', attendees: ['a@x.com', 'b@x.com'], organizer: 'a@x.com', description: 'Agenda' }))!;
    expect(s).toMatchObject({ kind: 'calendar', externalId: 'e1@2026-11-14T10:00:00+05:00', threadKey: 'e1', title: 'Sync', body: 'Agenda' });
    expect(s.occurredAt).toEqual(new Date('2026-11-14T05:00:00Z'));
    expect(s.participants).toEqual(['a@x.com', 'b@x.com']);
    expect(s.details).not.toHaveProperty('description');
  });

  it('chat, WhatsApp and tasks land with their text; a voice note lands as its transcript', () => {
    expect(sourceFromFeedItem(item('gchat', { messageName: 'spaces/1/messages/9', threadName: 'spaces/1/threads/3', spaceDisplayName: 'Deals', senderDisplayName: 'Ali', text: 'ok' })))
      .toMatchObject({ kind: 'chat', externalId: 'spaces/1/messages/9', threadKey: 'spaces/1/threads/3', title: 'Deals', body: 'ok' });
    expect(sourceFromFeedItem(item('whatsapp', { waMessageId: 'w1', chatId: 'c@lid', senderName: 'Me', body: '', voiceTranscript: 'call Ali' })))
      .toMatchObject({ kind: 'whatsapp', externalId: 'w1', threadKey: 'c@lid', body: 'call Ali' });
    expect(sourceFromFeedItem(item('gtasks', { title: 'Renew licence', notes: 'by Friday' }, 'task-7')))
      .toMatchObject({ kind: 'task', externalId: 'task-7', title: 'Renew licence', body: 'by Friday' });
  });

  it('a feed the Wiki does not know is not guessed at', () => {
    expect(sourceFromFeedItem(item('erp', {}))).toBeNull();
  });

  it('the same item always has the same source id; another user\'s is a different source', () => {
    expect(sourceId('T-1', 2, 'email', 'm1')).toBe(sourceId('T-1', 2, 'email', 'm1'));
    expect(sourceId('T-1', 2, 'email', 'm1')).not.toBe(sourceId('T-1', 3, 'email', 'm1'));
    expect(sourceId('T-1', 2, 'email', 'm1')).toMatch(/^src_[0-9a-f]{28}$/);
  });

  it('reads the text out of an old email page', () => {
    expect(emailPageText('# Subject\n\n**From:** a@x.com\n\n## Body\nHello there.\nBye.')).toBe('Hello there.\nBye.');
    expect(emailPageText('# no body section')).toBe('');
    expect(emailPageText(null)).toBe('');
  });
});
