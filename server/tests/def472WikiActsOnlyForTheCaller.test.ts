/**
 * DEF-472 — the /v1/wiki routes honoured `X-On-Behalf-Of-User` for ANY
 * signed-in user, so a user could read or write a colleague's Wiki by naming
 * their user id. The header existed for machine agents (wiki_scribe), which the
 * Wiki no longer answers (Wiki-Knowledge §0.8). Found 13 Nov 2026 by the
 * privacy matrix; no caller in this project or any other on the server sends it.
 *
 * Now a request acts for the signed-in user only: the header is accepted only
 * when it names the caller, and refused (401) otherwise.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'wikiRoutes.ts'), 'utf8');
const fnText = src.slice(src.indexOf('function resolveTargetUser'), src.indexOf('\n}\n', src.indexOf('function resolveTargetUser')) + 2);
// The helper, compiled from its source, on its own.
const ts = require('typescript');
const js = ts.transpileModule(fnText, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
// eslint-disable-next-line no-new-func
const resolveTargetUser = new Function(`${js}; return resolveTargetUser;`)() as (req: any) => { clientNumber: string; userId: number } | null;

const req = (userId: number, header?: string | string[]) => ({ user: { id: userId, clientNumber: 'T-1' }, headers: header === undefined ? {} : { 'x-on-behalf-of-user': header } });

describe('DEF-472: the Wiki acts only for the signed-in user', () => {
  it('a plain request acts for the caller', () => {
    expect(resolveTargetUser(req(7))).toEqual({ clientNumber: 'T-1', userId: 7 });
  });
  it('the header naming another user is refused', () => {
    expect(resolveTargetUser(req(7, '8'))).toBeNull();
    expect(resolveTargetUser(req(7, ['8']))).toBeNull();
    expect(resolveTargetUser(req(7, 'abc'))).toBeNull();
    expect(resolveTargetUser(req(7, ''))).toBeNull();
  });
  it('the header naming the caller is harmless', () => {
    expect(resolveTargetUser(req(7, '7'))).toEqual({ clientNumber: 'T-1', userId: 7 });
  });
  it('every route refuses when the helper refuses', () => {
    const uses = src.match(/const ctx = resolveTargetUser\(req\);\s*if \(!ctx\) return res\.status\(401\)/g) ?? [];
    expect(uses.length).toBe((src.match(/resolveTargetUser\(req\)/g) ?? []).length);
  });
});
