/**
 * T33 P2-P4 (both AGREE 17 Nov 2026), the task trail's SQL, proven on a throwaway Postgres (RACE_PG_URL, port 55432,
 * db race; refuses anything else). Pinned:
 *  TRAIL    trailPush appends in order and keeps the newest TRAIL_MAX;
 *  LINK     linkThread links a thread once (a second link of the same thread changes nothing);
 *  REPLIES  taskReplies reads replies on a linked thread after it was linked, never his own mail or older mail;
 *  CHANGES  /v1/changes flags "actions" when a reply lands on a linked thread, and not before;
 *  PACK     threadTaskLinks gives thread → open task (a closed task's threads are left out).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

const URL_ = vi.hoisted(() => { const u = process.env.RACE_PG_URL; if (u) process.env.DATABASE_URL = u; return u; });
vi.mock('../src/services/suzi/suziRules', () => ({ rulesDocument: async () => null }));

const run = URL_ ? describe : describe.skip;
run('task trail (real Postgres)', () => {
  let prisma: any; let trail: any; let changesSince: any;
  beforeAll(async () => {
    prisma = (await import('../src/db/prisma')).default;
    const port = await prisma.$queryRawUnsafe(`SELECT current_setting('port') AS p, current_database() AS d`);
    if (port[0].p !== '55432' || port[0].d !== 'race') throw new Error(`refusing: not the throwaway server (${JSON.stringify(port)})`);
    for (const t of [
      `CREATE TABLE IF NOT EXISTS open_items (client_number text, user_id int, updated_at timestamptz)`,
      `ALTER TABLE open_items ADD COLUMN IF NOT EXISTS id text`,
      `ALTER TABLE open_items ADD COLUMN IF NOT EXISTS metadata jsonb`,
      `ALTER TABLE open_items ADD COLUMN IF NOT EXISTS status text`,
      `CREATE TABLE IF NOT EXISTS wiki_sources (client_number text, user_id int, kind text, external_id text, thread_key text, occurred_at timestamptz, details jsonb, body_text text, created_at timestamptz DEFAULT now())`,
      `CREATE TABLE IF NOT EXISTS users (id int, client_number text)`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email text`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences jsonb`,
      `CREATE TABLE IF NOT EXISTS feed_events (client_number text, user_id int, source_type text, created_at timestamptz)`,
      `CREATE TABLE IF NOT EXISTS meeting_records (client_number text, user_id int, changed_at timestamptz)`,
      `CREATE TABLE IF NOT EXISTS decision_logs (client_number text, user_id int, created_at timestamptz)`,
      `CREATE TABLE IF NOT EXISTS suzi_rules_version (client_number text, user_id int, updated_at timestamptz)`,
      `CREATE TABLE IF NOT EXISTS persons (client_number text, user_id int, updated_at timestamptz)`,
    ]) await prisma.$executeRawUnsafe(t);
    for (const t of ['open_items', 'wiki_sources']) await prisma.$executeRawUnsafe(`DELETE FROM ${t} WHERE client_number = 'T33'`);
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = 9033`);
    await prisma.$executeRawUnsafe(`INSERT INTO users (id, client_number, email) VALUES (9033, 'T33', 'basit@x.com')`);
    await prisma.$executeRawUnsafe(`INSERT INTO open_items (id, client_number, user_id, status, metadata, updated_at) VALUES
      ('i1', 'T33', 9033, 'DELEGATED', '{}'::jsonb, now() - interval '1 hour'), ('i2', 'T33', 9033, 'CLOSED', '{}'::jsonb, now() - interval '1 hour')`);
    trail = await import('../src/services/suzi/suziTaskTrail');
    ({ changesSince } = await import('../src/services/suzi/suziChanges'));
  });

  const meta = async (id: string) => (await prisma.$queryRawUnsafe(`SELECT metadata FROM open_items WHERE id = $1`, id))[0].metadata;

  it('TRAIL: entries append in order; only the newest TRAIL_MAX are kept', async () => {
    await trail.trailPush('i1', { who: 'you, through Suzi', change: 'Helper added: Sara', at: '2026-11-18T10:00:00.000Z' });
    await trail.trailPush('i1', { who: 'you, through Suzi', change: 'Renamed', note: 'a → b', at: '2026-11-18T10:01:00.000Z' });
    expect(trail.trailOf(await meta('i1')).map((e: any) => e.change)).toEqual(['Helper added: Sara', 'Renamed']);
    const many = Array.from({ length: trail.TRAIL_MAX + 3 }, (_, i) => ({ at: new Date(Date.UTC(2026, 10, 18, 11, 0, i)).toISOString(), who: 'Nexeo', change: `e${i}` }));
    await prisma.$executeRawUnsafe(`UPDATE open_items SET metadata = jsonb_build_object('suziTrail', $1::jsonb) WHERE id = 'i2'`, JSON.stringify(many.slice(0, -1)));
    await trail.trailPush('i2', many[many.length - 1]);
    const kept = trail.trailOf(await meta('i2'));
    expect(kept).toHaveLength(trail.TRAIL_MAX);
    expect(kept[0].change).toBe('e3');
    expect(kept[kept.length - 1].change).toBe(`e${trail.TRAIL_MAX + 2}`);
  });

  it('LINK + REPLIES + CHANGES + PACK', async () => {
    const linkedAt = new Date(Date.now() - 30 * 60_000);
    await trail.linkThread('i1', 'th-1', linkedAt);
    await trail.linkThread('i1', 'th-1', new Date());
    await trail.linkThread('i2', 'th-closed', linkedAt);
    expect(trail.threadsOf(await meta('i1'))).toEqual([{ thread_id: 'th-1', since: linkedAt.toISOString() }]);
    await prisma.$executeRawUnsafe(`UPDATE open_items SET updated_at = now() - interval '1 hour' WHERE client_number = 'T33'`); // only the reply may flag
    const before = new Date(Date.now() - 1000);
    expect((await changesSince('T33', 9033, before.toISOString())).changed).not.toContain('actions');
    await prisma.$executeRawUnsafe(`INSERT INTO wiki_sources (client_number, user_id, kind, external_id, thread_key, occurred_at, details, body_text) VALUES
      ('T33', 9033, 'email', 'm-old', 'th-1', $1, '{"from":"Sara Khan <sara@x.com>"}', 'before the link'),
      ('T33', 9033, 'email', 'm-mine', 'th-1', now() - interval '5 minutes', '{"from":"Basit Ahmed <basit@x.com>"}', 'his own'),
      ('T33', 9033, 'email', 'm-reply', 'th-1', now() - interval '2 minutes', '{"from":"Sara Khan <sara@x.com>"}', 'Done, the draft is   attached.')`,
      new Date(linkedAt.getTime() - 60_000));
    const r = await trail.taskReplies('T33', 9033, [{ id: 'i1', metadata: await meta('i1') }]);
    expect(r.get('i1')).toEqual([expect.objectContaining({ who: 'Sara Khan', change: 'reply', note: 'Done, the draft is attached.', thread_id: 'th-1', email_id: 'm-reply' })]);
    expect((await changesSince('T33', 9033, before.toISOString())).changed).toContain('actions');
    const links = await trail.threadTaskLinks('T33', 9033);
    expect(links.get('th-1')).toEqual({ id: 'i1', since: linkedAt.toISOString() });
    expect(links.has('th-closed')).toBe(false);
  });
});
