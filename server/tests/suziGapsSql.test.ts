/**
 * Link T28: suziGaps.ts's SQL run against a real, throwaway Postgres with the migration applied. Skipped
 * unless SCRATCH_PG_URL is set, so it never touches a real database by accident. To run:
 *   docker run -d --rm --name pg-scratch -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:55433:5432 postgres:16-alpine
 *   docker exec -i pg-scratch psql -U postgres -v ON_ERROR_STOP=1 < prisma/migrations/20261106_suzi_gaps/migration.sql
 *   SCRATCH_PG_URL=postgresql://postgres@127.0.0.1:55433/postgres npx vitest run tests/suziGapsSql.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const URL = process.env.SCRATCH_PG_URL;
const holder: { client: any } = { client: null };
vi.mock('../src/db/prisma', () => ({
  default: new Proxy({}, { get: (_t, k) => holder.client?.[k] }),
}));

import { runGapOp, listGaps, setGapState } from '../src/services/suzi/suziGaps';

const signed = { signatureVerified: true, voiceScore: 0.9, confirmed: true, deviceId: 'dev1' };

describe.skipIf(!URL)('suzi_gaps SQL on a scratch Postgres', () => {
  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    holder.client = new PrismaClient({ datasources: { db: { url: URL! } } });
    await holder.client.$executeRawUnsafe('TRUNCATE suzi_gaps RESTART IDENTITY');
  });
  afterAll(async () => { await holder.client?.$disconnect(); });

  it('reports, merges duplicates (same wording or close spelling), keeps users apart, approves, lists and sets state', async () => {
    const a: any = await runGapOp('T', 2, 'gap.report', { said: 'Suzi, that is wrong, the board did not close', what: 'The board should close after the report', seen_on: 'board', approved: false }, signed);
    expect(a).toMatchObject({ ok: true, item: { id: 'G-1', state: 'new', count: 1, merged: false } });

    const b: any = await runGapOp('T', 2, 'gap.report', { said: 'again the board stays', what: 'the board should close, after the report!', approved: true }, signed);
    expect(b).toMatchObject({ ok: true, item: { id: 'G-1', state: 'approved', count: 2, merged: true, said: 'again the board stays', seen_on: 'board' } });

    // Very close spelling (similarity 0.92) merges.
    const c: any = await runGapOp('T', 2, 'gap.report', { said: 'x', what: 'The boards should close after the report', approved: true }, signed);
    expect(c.item).toMatchObject({ id: 'G-1', count: 3, merged: true });

    // A change of meaning scores higher (0.73) than two typos (0.69), so neither merges: a duplicate is
    // sorted by hand, two different gaps are never folded into one.
    const opposite: any = await runGapOp('T', 2, 'gap.report', { said: 'x', what: 'The board should open after the report', approved: true }, signed);
    expect(opposite.item).toMatchObject({ id: 'G-2', merged: false });
    await holder.client.$executeRawUnsafe(`DELETE FROM suzi_gaps WHERE gap_no = 2`);

    const other: any = await runGapOp('T', 3, 'gap.report', { said: 'x', what: 'The board should close after the report', approved: true }, signed);
    expect(other.item).toMatchObject({ id: 'G-3', merged: false });

    const d: any = await runGapOp('T', 2, 'gap.report', { said: 'y', what: 'Read the delegation matrix as columns', approved: false }, signed);
    expect(d.item).toMatchObject({ id: 'G-4', state: 'new' });

    const reports = await holder.client.$queryRawUnsafe(`SELECT jsonb_array_length(reports) AS n, reports->-1->>'said' AS last FROM suzi_gaps WHERE gap_no = 1`);
    expect(reports[0]).toEqual({ n: 3, last: 'x' });

    expect(await runGapOp('T', 2, 'gap.approve', { id: 'G-4' }, signed)).toMatchObject({ ok: true, item: { id: 'G-4', state: 'approved' } });
    expect(await runGapOp('T', 2, 'gap.approve', { id: 'G-3' }, signed)).toMatchObject({ ok: false, error: 'not_found' });

    const mine = await listGaps('T', 2);
    expect(mine.map((g) => g.id)).toEqual(['G-4', 'G-1']);
    expect(await listGaps('T', 2, { state: 'new' })).toEqual([]);

    expect(await setGapState('T', 2, { id: 'G-1', state: 'sorted', owner: 'suzi', handover: 'inbox/20261106-170000-nexeo-gap-G-1.md' })).toMatchObject({ ok: true, item: { state: 'sorted', owner: 'suzi' } });
    expect(await setGapState('T', 2, { id: 'G-1', state: 'live', built_version: '0.4.2' })).toMatchObject({ ok: true, item: { state: 'live', owner: 'suzi', built_version: '0.4.2', handover: 'inbox/20261106-170000-nexeo-gap-G-1.md' } });

    // A live gap is closed: the same report again opens a new one.
    const again: any = await runGapOp('T', 2, 'gap.report', { said: 'z', what: 'The board should close after the report', approved: true }, signed);
    expect(again.item).toMatchObject({ id: 'G-5', merged: false });
  });
});
