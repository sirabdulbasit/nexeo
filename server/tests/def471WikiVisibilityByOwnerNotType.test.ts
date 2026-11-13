/**
 * DEF-471 — the Wiki screen's single-page and graph routes decided who may
 * read a page by its TYPE: any signed-in user of the client could open another
 * user's private project, decision, pattern, policy or attachment page, and the
 * graph added people and topics. Found 13 Nov 2026 by the Wiki session while
 * building the privacy matrix (fourth outside review, P2). No second user of
 * any client could sign in at the time, so nothing was read; on production
 * 2,347 private pages of those types (and 1,949 people and topic pages via the
 * graph) were exposed to the next colleague added.
 *
 * Rule (docs/Wiki-Knowledge.md §0.1.6): who may read follows whose page it is,
 * the company's (scope 'tenant') or the reader's own; never its type.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROUTES = path.join(__dirname, '..', 'src', 'routes');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/--.*$/gm, '');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);
}

describe('DEF-471: a Wiki page is readable by its owner or by the company, never by its type', () => {
  it('no route grants reading a wiki page because of its type', () => {
    const offenders: string[] = [];
    for (const f of files(ROUTES)) {
      const src = strip(fs.readFileSync(f, 'utf8'));
      // SQL form: "OR w.page_type IN ('org_doc', …)" next to a user filter; Prisma form: "{ pageType: { in: ['org_doc', …] } }" inside an OR.
      if (/OR\s+\w+\.page_type\s+IN\s*\(\s*'org_doc'/i.test(src)) offenders.push(`${path.relative(ROUTES, f)} (sql)`);
      if (/OR:\s*\[[^\]]*\{\s*userId:[^}]*\}\s*,\s*\{\s*pageType:\s*\{\s*in:/s.test(src)) offenders.push(`${path.relative(ROUTES, f)} (prisma)`);
    }
    expect(offenders).toEqual([]);
  });

  it('the single-page and graph routes read by scope and owner', () => {
    const src = strip(fs.readFileSync(path.join(ROUTES, 'brainAskRoutes.ts'), 'utf8'));
    const graph = src.slice(src.indexOf("router.get('/wiki/pages/:id/graph'"), src.indexOf("router.get('/wiki/pages/:id',"));
    const page = src.slice(src.indexOf("router.get('/wiki/pages/:id',"), src.indexOf("router.patch('/wiki/pages/:id/archive'"));
    expect((graph.match(/w\.scope = 'tenant' OR \(w\.scope = 'user' AND w\.user_id = \$3\)/g) ?? []).length).toBe(2);
    expect(graph).toMatch(/if \(!root\) return res\.status\(404\)/); // the page itself must be visible first
    expect(page).toMatch(/\{ scope: 'tenant' \},\s*\{ scope: 'user', userId: user\.id \}/);
    expect(page).not.toMatch(/pageType:\s*\{\s*in:/);
  });
});
