/**
 * F-2.4 proof (a) on a REAL Postgres (Nexeo-Suzi, 14 Nov: "two runs in parallel against a real Postgres", not prod).
 * Runs only with RACE_PG_URL set to a throwaway server; it refuses to run unless that server answers on port 55432.
 * Racers reach the claim together (a barrier after their draft rows exist), each on its own pooled connection, and
 * the unique agent_actions.idempotency_key decides: exactly one reaches Gmail Drafts, every other one is
 * "already_forwarded". Gmail is the only thing faked (a counter of saved drafts).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

const URL_ = vi.hoisted(() => { const u = process.env.RACE_PG_URL; if (u) process.env.DATABASE_URL = u; return u; });
const st = vi.hoisted(() => ({ waiting: 0, want: 2, release: null as null | (() => void), gate: null as null | Promise<void>, drafts: [] as string[] }));

vi.mock('../src/services/suzi/suziPeople', () => ({ personById: async () => ({ id: 'p1', name: 'Ali', email: 'ali@tmc.com' }) }));
vi.mock('../src/services/suzi/suziEmail', async () => {
  const prisma = (await import('../src/db/prisma')).default;
  return {
    latestMail: async () => ({ subject: 'Quote', senderEmail: 'v@vendor.com' }),
    forwardEmail: async () => {
      const r = await prisma.$queryRawUnsafe<Array<{ id: number }>>(`INSERT INTO agent_actions (client_number, user_id, action_type, input, output) VALUES ('RACE', 2, 'draft_reply', '{}', '{}') RETURNING id`);
      st.waiting += 1;
      if (st.waiting >= st.want) st.release!();
      await st.gate; // every racer has its row before any claims
      return { ok: true, item: { draft_id: String(r[0].id) } };
    },
    saveToGmailDrafts: async (_c: string, _u: number, a: any) => { st.drafts.push(a.draft_id); return { ok: true, item: { sent: true, undo_until: 'x' } }; },
    saveNewDraft: async () => ({ ok: true }), writeWithModel: async () => '',
  };
});

const run = URL_ ? describe : describe.skip;
run('F-2.4 (a) on a real Postgres', () => {
  let prisma: any; let emailDelegate: any;
  beforeAll(async () => {
    prisma = (await import('../src/db/prisma')).default;
    const port = await prisma.$queryRawUnsafe(`SELECT current_setting('port') AS p, current_database() AS d`);
    if (port[0].p !== '55432' || port[0].d !== 'race') throw new Error(`refusing: not the throwaway server (${JSON.stringify(port)})`);
    ({ emailDelegate } = await import('../src/services/suzi/suziDelegate'));
  });
  for (const n of [2, 8]) {
    it(`${n} concurrent ticks on one message: one Gmail draft, ${n - 1} already_forwarded`, async () => {
      await prisma.$executeRawUnsafe(`DELETE FROM agent_actions WHERE client_number = 'RACE'`);
      st.waiting = 0; st.want = n; st.drafts = []; st.gate = new Promise<void>((r) => { st.release = r; });
      const gate = { signatureVerified: false, voiceScore: null, byRule: 'r1' };
      const out = await Promise.all(Array.from({ length: n }, () => emailDelegate('RACE', 2, { email_id: 't1', rule_id: 'r1', person_id: 'p1', message_id: `m-${n}` }, true, gate)));
      const pids = await prisma.$queryRawUnsafe(`SELECT count(DISTINCT pid)::int AS n FROM pg_stat_activity WHERE datname = 'race'`);
      const rows = await prisma.$queryRawUnsafe(`SELECT idempotency_key IS NOT NULL AS claimed, output->'send'->>'state' AS st, output->'send'->>'error' AS err FROM agent_actions WHERE client_number = 'RACE'`);
      console.log(JSON.stringify({ n, ok: out.filter((o: any) => o.ok).length, already: out.filter((o: any) => o.error === 'already_forwarded').length, drafts: st.drafts.length, claimed: rows.filter((r: any) => r.claimed).length, rows: rows.length, connections: pids[0].n }));
      expect(st.drafts).toHaveLength(1);
      expect(out.filter((o: any) => o.ok)).toHaveLength(1);
      expect(out.filter((o: any) => o.error === 'already_forwarded')).toHaveLength(n - 1);
      expect(rows.filter((r: any) => r.claimed)).toHaveLength(1);
      expect(rows.filter((r: any) => r.err === 'already_forwarded')).toHaveLength(n - 1);
    });
  }
});
