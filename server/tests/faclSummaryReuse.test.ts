/**
 * Cost, founder 28 Nov 2026 ("optimize the cost with existing performance"): the FACL scribe writes a new summary only
 * when what the model reads changed. Pinned: a fresh "Last updated" stamp alone reuses the last summary; a real
 * change in the first 15,000 characters, or a new title, writes a new one; a change past what the model reads does
 * not; a page with no stored summary always gets one.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/prisma', () => ({ default: {} }));

import { isObsoleteFaclFile, reusableSummary, scribeFaclForTenant, summaryKeyOf } from '../src/services/knowledge/folderScribeService';

const index = (stamp: string, rows: string) => `# TMC Drive Index\n_Last updated: ${stamp}_\n\n| File | Id |\n${rows}`;

describe('FACL summary reuse', () => {
  it('a new date-time stamp alone keeps the summary', () => {
    const a = summaryKeyOf('TMC_Drive_Index.md', index('2026-11-28T10:49:07.320Z', '| A | 1 |'));
    const b = summaryKeyOf('TMC_Drive_Index.md', index('2026-11-28T14:51:58.598Z', '| A | 1 |'));
    expect(a).toBe(b);
    expect(reusableSummary({ summaryKey: a, summaryMd: '- The Drive index of TMC files and where each lives.' }, b)).toBe('- The Drive index of TMC files and where each lives.');
  });
  it('a real change in what the model reads writes a new summary', () => {
    const a = summaryKeyOf('TMC_Drive_Index.md', index('2026-11-28T10:49:07Z', '| A | 1 |'));
    const b = summaryKeyOf('TMC_Drive_Index.md', index('2026-11-28T10:49:07Z', '| B | 2 |'));
    expect(a).not.toBe(b);
    expect(reusableSummary({ summaryKey: a, summaryMd: '- old summary of the index' }, b)).toBeNull();
  });
  it('a change past the first 15,000 characters (not read by the model) keeps it; another title does not', () => {
    const head = 'x'.repeat(15_000);
    expect(summaryKeyOf('Doc', `${head}tail one`)).toBe(summaryKeyOf('Doc', `${head}tail two`));
    expect(summaryKeyOf('Doc', 'same text here')).not.toBe(summaryKeyOf('Other', 'same text here'));
  });
  it('a page with no stored summary, or an empty one, always gets a new summary', () => {
    const k = summaryKeyOf('Doc', 'text');
    expect(reusableSummary({}, k)).toBeNull();
    expect(reusableSummary(null, k)).toBeNull();
    expect(reusableSummary({ summaryKey: k, summaryMd: '' }, k)).toBeNull();
  });
  it('the obsolete TMC Drive Index (sheet and .md) is never read; other files are', () => {
    for (const n of ['TMC Drive Index', 'TMC_Drive_Index.md', 'tmc drive index']) expect(isObsoleteFaclFile(n)).toBe(true);
    for (const n of ['TMC_Context', 'Drive Index notes for TMC', 'HaseebOS Open Items']) expect(isObsoleteFaclFile(n)).toBe(false);
  });
  it('the client-level knowledge folder is removed: a leftover call reads and writes nothing', async () => {
    const r = await scribeFaclForTenant('TMC-0001', 'folder-1');
    expect(r).toMatchObject({ clientNumber: 'TMC-0001', scanned: 0, updated: 0, errors: 0 });
  });
});
