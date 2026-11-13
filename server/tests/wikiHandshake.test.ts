/**
 * The Wiki handshakes only with Nexeo and Suzi (docs/Wiki-Knowledge.md §0.8).
 * A machine token is neither, so the Wiki's routes refuse it; a signed-in
 * person passes. The routes that carry the guard are pinned by reading the source.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { wikiHandshakeOnly, WIKI_HANDSHAKE_REFUSAL } from '../src/middleware/wikiHandshake';

function call(user: unknown) {
  const out: { status?: number; body?: unknown; passed: boolean } = { passed: false };
  const res: any = { status: (c: number) => { out.status = c; return res; }, json: (b: unknown) => { out.body = b; return res; } };
  wikiHandshakeOnly({ user } as any, res, () => { out.passed = true; });
  return out;
}

describe('the Wiki handshakes only with Nexeo and Suzi', () => {
  it('refuses a machine token', () => {
    expect(call({ clientNumber: 'T-1', isAgent: true })).toEqual({ passed: false, status: 403, body: { error: WIKI_HANDSHAKE_REFUSAL } });
  });
  it('lets a signed-in person through', () => {
    expect(call({ id: 2, clientNumber: 'T-1' })).toEqual({ passed: true });
  });
  it('guards every route that serves the Wiki', () => {
    const src = (f: string) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
    expect(src('app.ts')).toContain("v1.use('/wiki', wikiHandshakeOnly, wikiRoutes)");
    expect(src('routes/brainAskRoutes.ts')).toContain("router.use('/wiki', wikiHandshakeOnly)");
  });
});
