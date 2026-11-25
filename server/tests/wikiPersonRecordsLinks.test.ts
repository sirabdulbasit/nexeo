/**
 * Found live 25 Nov (D-313): linking a record's manager by name when no note existed left 50 People notes
 * with links that could never resolve, so every build rewrote them. A link is made only to a note that
 * exists, found by the person's exact email or a business unit / company title (Wiki-Knowledge §0.31).
 */
import { describe, it, expect, vi } from 'vitest';

const db = vi.hoisted(() => ({
  $queryRawUnsafe: vi.fn(),
  wikiPage: { findMany: vi.fn() },
}));
vi.mock('../src/db/prisma', () => ({ __esModule: true, default: db, prisma: db }));

import { loadPersonRecords } from '../src/services/wiki/wikiBuilder';

describe('loadPersonRecords: links only to notes that exist', () => {
  it('a manager with a People note (by email) links to that note; one without stays text', async () => {
    db.$queryRawUnsafe.mockResolvedValue([
      { id: 's1', title: 'Abdul Rafay Hussain', details: { integration: 'TMC Employee Directory', fields: { email: 'abdul.rafay@tmcltd.com', reportsTo: 'Rai Sohaib Amjad' } } },
      { id: 's2', title: 'Rai Sohaib Amjad', details: { integration: 'TMC Employee Directory', fields: { email: 'rai@tmcltd.com' } } },
      { id: 's3', title: 'Nobody Known', details: { integration: 'TMC Employee Directory', fields: { email: 'nobody@tmcltd.com' } } },
      { id: 's4', title: 'Stale', details: { integration: 'X', fields: {} } },
    ]);
    db.wikiPage.findMany.mockResolvedValue([
      { title: 'Rai Sohaib', pageType: 'person', metadata: { ids: ['email:rai@tmcltd.com'] } },
      { title: 'TMC Private Limited', pageType: 'business_unit', metadata: { ids: ['business_unit:tmc private limited'] } },
    ]);
    const { records, linkable } = await loadPersonRecords('TMC-0001', 2);
    expect(records.get('abdul.rafay@tmcltd.com')?.[0]).toMatchObject({ sourceId: 's1', integration: 'TMC Employee Directory' });
    expect(linkable.get('rai sohaib amjad')).toBe('Rai Sohaib');           // through his address, not his name
    expect(linkable.get('tmc private limited')).toBe('TMC Private Limited');
    expect(linkable.has('nobody known')).toBe(false);                     // no note: no link
    expect(linkable.has('abdul rafay hussain')).toBe(false);
    expect(String(db.$queryRawUnsafe.mock.calls[0][0])).toMatch(/kind = 'record'.*store' = 'integration'.*stale/s);
  });
});
