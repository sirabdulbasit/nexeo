/**
 * /v1/changes flags "calendar" on a REAL change of one of his meeting records (suzi-b5 AGREE, 16 Nov 2026), proven on
 * a throwaway Postgres (RACE_PG_URL, port 55432, db race; refuses anything else). The two meeting migrations are
 * applied as written. Conditions: (1) status/reason, notes or items changed → flag; a same-status write or a re-read
 * with the same notes → no flag; (2) his leave (his_choice, no push) flags; (3) only his own records.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const URL_ = vi.hoisted(() => { const u = process.env.RACE_PG_URL; if (u) process.env.DATABASE_URL = u; return u; });
vi.mock('../src/services/suzi/suziRules', () => ({ rulesDocument: async () => null }));
vi.mock('../src/services/suzi/gatewayAdminClient', () => ({ pushMeetingStatus: async () => ({ delivered: 0 }) }));

const run = URL_ ? describe : describe.skip;
run('meeting changes flag calendar (real Postgres)', () => {
  let prisma: any; let store: any; let changesSince: any;
  const pause = () => new Promise((r) => setTimeout(r, 15));
  const flagged = async (since: Date, userId = 2) => (await changesSince('RACE', userId, since.toISOString())).changed.includes('calendar');
  beforeAll(async () => {
    prisma = (await import('../src/db/prisma')).default;
    const port = await prisma.$queryRawUnsafe(`SELECT current_setting('port') AS p, current_database() AS d`);
    if (port[0].p !== '55432' || port[0].d !== 'race') throw new Error(`refusing: not the throwaway server (${JSON.stringify(port)})`);
    for (const m of ['20261112_meeting_records', '20261116_meeting_records_changed_at']) {
      const sql = readFileSync(join(__dirname, '../prisma/migrations', m, 'migration.sql'), 'utf8');
      for (const stmt of sql.split(/;\s*\n/).map((x) => x.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) await prisma.$executeRawUnsafe(stmt);
    }
    for (const t of [
      `CREATE TABLE IF NOT EXISTS open_items (client_number text, user_id int, updated_at timestamptz)`,
      `ALTER TABLE open_items ADD COLUMN IF NOT EXISTS metadata jsonb`, // T33 P4 reads linked threads
      `CREATE TABLE IF NOT EXISTS feed_events (client_number text, user_id int, source_type text, created_at timestamptz)`,
      `CREATE TABLE IF NOT EXISTS decision_logs (client_number text, user_id int, created_at timestamptz)`,
      `CREATE TABLE IF NOT EXISTS suzi_rules_version (client_number text, user_id int, updated_at timestamptz)`,
      `CREATE TABLE IF NOT EXISTS persons (client_number text, user_id int, updated_at timestamptz)`,
      `CREATE TABLE IF NOT EXISTS risk_flag_docs (client_number text, user_id int, generated_at timestamptz)`, // T38
      `CREATE TABLE IF NOT EXISTS wiki_sources (client_number text, user_id int, kind text, external_id text, thread_key text, occurred_at timestamptz, details jsonb, body_text text, created_at timestamptz DEFAULT now())`, // T33 P4 (same shape as t33TaskTrailRealPg)
    ]) await prisma.$executeRawUnsafe(t);
    await prisma.$executeRawUnsafe(`DELETE FROM meeting_records WHERE client_number = 'RACE'`);
    store = await import('../src/services/meetings/meetingRecordStore');
    ({ changesSince } = await import('../src/services/suzi/suziChanges'));
  });

  it('real changes flag; same-status writes and same notes do not; his leave flags; other users never', async () => {
    let t = new Date(); await pause();
    const r = await store.setStatus('RACE', 2, 'event:e1', 'transcribing', { title: 'Catalogues', eventId: 'e1' }); // attend
    expect(await flagged(t)).toBe(true);
    await pause(); t = new Date(); await pause();
    await store.setStatus('RACE', 2, 'event:e1', 'transcribing', { title: 'Catalogues', eventId: 'e1' }); // same again
    expect(await flagged(t)).toBe(false);
    const notes = { minutes: 'm1', minutes_offered: null, decisions: [], action_items: [{ id: 'a', title: 'x', state: 'proposed' }], updated: false };
    await store.saveDerived(r.id, notes);
    await pause(); t = new Date(); await pause();
    await store.saveDerived(r.id, { ...notes, updated: true }); // a re-read with the same notes
    expect(await flagged(t)).toBe(false);
    await store.setActionItemState('RACE', 2, r.id, 'a', 'proposed'); // same state
    expect(await flagged(t)).toBe(false);
    await store.setActionItemState('RACE', 2, r.id, 'a', 'skipped');
    expect(await flagged(t)).toBe(true);
    await pause(); t = new Date(); await pause();
    await store.setStatus('RACE', 2, 'event:e2', 'not_covered', { eventId: 'e2', reason: 'his_choice', quiet: true }); // his leave
    expect(await flagged(t)).toBe(true);
    expect(await flagged(t, 3)).toBe(false); // someone else's records never flag his feed
  });
});
