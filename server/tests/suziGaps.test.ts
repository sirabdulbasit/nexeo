/**
 * Link T28 items 1-3 (both AGREE, 6 Nov 2026): build control. Pinned:
 *  1. only his verified voice opens a gap: signed, with a voice score, and confirmed; anything less touches nothing;
 *  2. approve needs a signed, confirmed call; an unknown id is not_found;
 *  3. the act route knows gap.report and gap.approve and audits them as gaps;
 *  4. GET /gaps is his own list; POST /gaps/state is loopback with the shared secret only, and Suzi's server
 *     relays no such route (checked on its side);
 *  5. no model anywhere in suziGaps.ts.
 *  The SQL itself is pinned against a real Postgres in suziGapsSql.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import path from 'path';

const query = vi.fn();
const userFindUnique = vi.fn();
const logCreate = vi.fn();
vi.mock('../src/db/prisma', () => ({
  default: {
    $queryRawUnsafe: (...a: any[]) => query(...a),
    user: { findUnique: (...a: any[]) => userFindUnique(...a) },
    suziActLog: { create: (...a: any[]) => logCreate(...a), findUnique: vi.fn(), update: vi.fn(async () => ({})) },
  },
}));
vi.mock('../src/services/suzi/gatewayAdminClient', () => ({ verifyGatewaySecret: async (t: any) => t === 'right-secret' }));
const auditFn = vi.fn();
vi.mock('../src/services/auditLogService', () => ({ audit: (...a: any[]) => auditFn(...a) }));

import { runGapOp, gapNo, normalise, GAP_OPS } from '../src/services/suzi/suziGaps';
import { ACT_OPS, act } from '../src/services/suzi/suziAct';
import router from '../src/routes/suziGatewayRoutes';

const row = { gap_no: 7, said: 's', what: 'w', seen_on: null, source: 'training', count: 1, state: 'approved', owner: null, handover: null, built_version: null, first_at: new Date('2026-11-06T12:00:00Z'), last_at: new Date('2026-11-06T12:00:00Z'), approved_at: null };
const signed = { signatureVerified: true, voiceScore: 0.9, confirmed: true };
const report = { said: 'that is wrong', what: 'the board should close', approved: true };

beforeEach(() => {
  for (const f of [query, userFindUnique, logCreate, auditFn]) f.mockReset();
  query.mockResolvedValue([]);
  userFindUnique.mockResolvedValue({ clientNumber: 'TMC-0001', isActive: true });
  logCreate.mockResolvedValue({ id: 'audit1' });
});

describe('only his verified voice opens a gap', () => {
  it('unsigned, unvoiced or unconfirmed: refused, and nothing is read or written', async () => {
    expect(await runGapOp('T', 2, 'gap.report', report, { ...signed, signatureVerified: false })).toMatchObject({ ok: false, error: 'needs_signature' });
    expect(await runGapOp('T', 2, 'gap.report', report, { ...signed, voiceScore: null })).toMatchObject({ ok: false, error: 'no_voice_score' });
    expect(await runGapOp('T', 2, 'gap.report', report, { ...signed, confirmed: false })).toMatchObject({ ok: false, error: 'needs_confirmation' });
    expect(await runGapOp('T', 2, 'gap.report', { said: '', what: 'x' }, signed)).toMatchObject({ ok: false, error: 'bad_gap' });
    expect(query).not.toHaveBeenCalled();
  });
  it('a signed, voiced, confirmed report is stored for this tenant and user, merged first if it matches', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([row]);
    const r: any = await runGapOp('TMC-0001', 2, 'gap.report', report, signed);
    expect(r).toMatchObject({ ok: true, item: { id: 'G-7', merged: false } });
    expect(query.mock.calls[0][0]).toContain('WHERE client_number = $1 AND user_id = $2');
    expect(query.mock.calls[0].slice(1, 4)).toEqual(['TMC-0001', 2, 'the board should close']);
    expect(query.mock.calls[1][0]).toContain('INSERT INTO suzi_gaps');
  });
  it('approve: signed and confirmed only; an unknown id is not_found', async () => {
    expect(await runGapOp('T', 2, 'gap.approve', { id: 'G-7' }, { ...signed, signatureVerified: false })).toMatchObject({ ok: false, error: 'needs_signature' });
    expect(await runGapOp('T', 2, 'gap.approve', { id: 'G-7' }, { ...signed, confirmed: false })).toMatchObject({ ok: false, error: 'needs_confirmation' });
    expect(await runGapOp('T', 2, 'gap.approve', { id: 'nonsense' }, signed)).toMatchObject({ ok: false, error: 'not_found' });
    expect(query).not.toHaveBeenCalled();
    expect(await runGapOp('T', 2, 'gap.approve', { id: 'G-7' }, signed)).toMatchObject({ ok: false, error: 'not_found' });
    expect(query.mock.calls[0][0]).toContain('WHERE gap_no = $3 AND client_number = $1 AND user_id = $2');
  });
});

describe('ids and wording', () => {
  it('G-12, g12 and 12 are gap 12; anything else is no id', () => {
    expect([gapNo('G-12'), gapNo('g12'), gapNo('12'), gapNo('x12'), gapNo('')]).toEqual([12, 12, 12, null, null]);
  });
  it('wording is compared without case or punctuation', () => {
    expect(normalise('The board, again!')).toBe(normalise('the board again'));
  });
});

describe('through act', () => {
  it('gap ops are act ops, passed the signature, voice and confirmation, and audited as gaps', async () => {
    expect(GAP_OPS.every((o) => (ACT_OPS as readonly string[]).includes(o))).toBe(true);
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([row]);
    const r = await act('TMC-0001', 2, { op: 'gap.report', args: report, idempotency_key: 'k1', confirmed_by_user: true, voice_score: 0.9, signature_verified: true, device_id: 'd1' });
    expect(r).toMatchObject({ status: 200, body: { ok: true, item: { id: 'G-7' } } });
    expect(auditFn.mock.calls[0][0]).toMatchObject({ action: 'suzi.act.gap.report', subjectType: 'suzi_gap' });
    const refused = await act('TMC-0001', 2, { op: 'gap.report', args: report, idempotency_key: 'k2', confirmed_by_user: true, voice_score: 0.9 });
    expect(refused).toMatchObject({ status: 400, body: { ok: false, error: 'needs_signature' } });
  });
});

describe('routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/g', router);
  const q = 'user_id=2&tenant_id=TMC-0001';
  it('GET /gaps is his own list', async () => {
    query.mockResolvedValue([row]);
    const r = await request(app).get(`/g/gaps?${q}`).set('Authorization', 'Bearer right-secret');
    expect(r.status).toBe(200);
    expect(r.body.gaps[0]).toMatchObject({ id: 'G-7', state: 'approved' });
    expect(query.mock.calls[0].slice(1)).toEqual(['TMC-0001', 2, null]);
  });
  it('POST /gaps/state: forwarded from outside 403, no secret 401, bad state 400', async () => {
    const body = { user_id: 2, tenant_id: 'TMC-0001', id: 'G-7', state: 'sorted', owner: 'suzi' };
    expect((await request(app).post('/g/gaps/state').set('Authorization', 'Bearer right-secret').set('X-Forwarded-For', '1.2.3.4').send(body)).status).toBe(403);
    expect((await request(app).post('/g/gaps/state').send(body)).status).toBe(401);
    expect((await request(app).post('/g/gaps/state').set('Authorization', 'Bearer right-secret').send({ ...body, state: 'done' })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    query.mockResolvedValue([{ ...row, state: 'sorted', owner: 'suzi' }]);
    const ok = await request(app).post('/g/gaps/state').set('Authorization', 'Bearer right-secret').send(body);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: 'G-7', state: 'sorted', owner: 'suzi' });
  });
});

describe('no model', () => {
  it('suziGaps.ts calls no LLM', () => {
    const src = readFileSync(path.join(__dirname, '../src/services/suzi/suziGaps.ts'), 'utf8');
    expect(src).not.toMatch(/callLLM|llmRouter|gemini|anthropic/i);
  });
});
