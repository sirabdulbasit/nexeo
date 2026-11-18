/**
 * T39, the store (throwaway Postgres, RACE_PG_URL port 55432 db race; refuses anything else). Pinned: within Google's
 * transcript way, Google's document replaces the API entries even with FEWER lines (it joins a speaker's entries), and
 * is never replaced back by entries; between two of the same kind, more words win; text_from is kept on the source.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const URL_ = vi.hoisted(() => { const u = process.env.RACE_PG_URL; if (u) process.env.DATABASE_URL = u; return u; });
vi.mock('../src/services/suzi/gatewayAdminClient', () => ({ pushMeetingStatus: async () => ({ delivered: 0 }) }));

const run = URL_ ? describe : describe.skip;
run('T39 store: the document wins (real Postgres)', () => {
  let prisma: any; let store: any;
  beforeAll(async () => {
    prisma = (await import('../src/db/prisma')).default;
    const port = await prisma.$queryRawUnsafe(`SELECT current_setting('port') AS p, current_database() AS d`);
    if (port[0].p !== '55432' || port[0].d !== 'race') throw new Error(`refusing: not the throwaway server (${JSON.stringify(port)})`);
    for (const m of ['20261112_meeting_records', '20261116_meeting_records_changed_at']) {
      const sql = readFileSync(join(__dirname, '../prisma/migrations', m, 'migration.sql'), 'utf8');
      for (const stmt of sql.split(/;\s*\n/).map((x) => x.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) await prisma.$executeRawUnsafe(stmt);
    }
    await prisma.$executeRawUnsafe(`DELETE FROM meeting_records WHERE client_number = 'T39'`);
    store = await import('../src/services/meetings/meetingRecordStore');
  });

  const L = (n: number, words: number) => Array.from({ length: n }, (_, i) => ({ t: new Date(Date.UTC(2026, 10, 16, 6, 0, i)).toISOString(), speaker: 'S', text: Array(words).fill('w').join(' ') }));
  const put = (lines: any[], textFrom?: string) => store.putTranscript('T39', 2, 'k1', { way: 'google_transcript', ref: 'tr/1', participants: [], transcript: lines, ...(textFrom ? { textFrom } : {}) });

  it('entries first; the document (fewer lines, more words) replaces them; entries never replace it back', async () => {
    const a = await put(L(232, 4), 'google_entries');
    expect(a.record.transcript).toHaveLength(232);
    const b = await put(L(162, 7), 'google_doc');
    expect(b.derive).toBe(true);
    expect(b.record.transcript).toHaveLength(162);
    expect(b.record.sources).toEqual([expect.objectContaining({ way: 'google_transcript', ref: 'tr/1', text_from: 'google_doc' })]);
    const c = await put(L(300, 9), 'google_entries');
    expect(c.derive).toBe(false);
    expect(c.record.transcript).toHaveLength(162);
    const d = await put(L(150, 9), 'google_doc'); // same kind: more words win (150 × 9 > 162 × 7)
    expect(d.derive).toBe(true);
    expect(d.record.transcript).toHaveLength(150);
    const e = await put(L(170, 5), 'google_doc'); // fewer words: kept as it was
    expect(e.derive).toBe(false);
  });
});
