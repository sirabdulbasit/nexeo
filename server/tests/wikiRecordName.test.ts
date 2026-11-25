/**
 * Found live 25 Nov (7dc488a3 deploy): record sources are titled by the person's name alone since D-313, and
 * recordName only read the part after "Integration · ", so every directory person was skipped as unnamed.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {}, prisma: {} }));

import { recordName, recordOnlyPeople, type PersonRecord } from '../src/services/wiki/wikiBuilder';

const rec = (title: string, fields: Record<string, string>): PersonRecord =>
  ({ integration: 'TMC Employee Directory', title, fields, sourceId: `s:${title}` });

describe('directory people from record sources titled by name (as stored since D-313)', () => {
  it('reads the name from a name-only title, an old prefixed title, or a name field', () => {
    expect(recordName(rec('Abdul Rafay Hussain', { email: 'abdul.rafay@tmcltd.com' }))).toBe('Abdul Rafay Hussain');
    expect(recordName(rec('TMC Employee Directory · Abdul Rafay', { email: 'a@x.com' }))).toBe('Abdul Rafay');
    expect(recordName(rec('E-1297', { name: 'Abdul Rafay Rasheed', email: 'r@x.com' }))).toBe('Abdul Rafay Rasheed');
  });

  it('a directory employee he never emailed gets a People note by name', () => {
    const records = new Map([
      ['abdul.rafay@tmcltd.com', [rec('Abdul Rafay Hussain', { email: 'abdul.rafay@tmcltd.com', designation: 'MTO' })]],
      ['rafay.rasheed@tmcltd.com', [rec('Abdul Rafay Rasheed', { email: 'rafay.rasheed@tmcltd.com' })]],
    ]);
    const out = recordOnlyPeople([], records, new Set());
    expect(out.map((p) => p.title).sort()).toEqual(['Abdul Rafay Hussain', 'Abdul Rafay Rasheed']);
  });
});
