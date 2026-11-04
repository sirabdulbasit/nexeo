/**
 * OPT-007 — the planner view of the tenant index lists only what the planner is told to use.
 *
 * Measured 2026-11-04: 320,754 characters (~80k tokens, 3,333 lines) on every
 * `retrieval_plan` call for a 768-token answer: 11.8M of the 32.5M Flash input tokens
 * billed in 8 days. The planner's rules already send topics, people, projects and
 * observations to the composer's vector search.
 *
 * Pinned:
 *  1. org_doc / policy / decision / pattern / mind_state are listed with id, title and
 *     first line (the FACL docs the planner names by title must stay findable);
 *  2. attachment_doc is listed by id and title only (the STRUCTURED-QUESTION rule needs
 *     the ids, not the previews);
 *  3. topic / entity_person / project / observation / answer / gap are NOT listed one by
 *     one; the view says they exist and how to reach them;
 *  4. tenant and user scoping of the query is unchanged.
 */
import { describe, it, expect, vi } from 'vitest';

const findMany = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { wikiPage: { findMany: (...a: any[]) => findMany(...a) }, $queryRaw: vi.fn() } }));

import { getCompactIndexForPlanner } from '../src/services/knowledge/tenantIndexService';

const page = (id: string, pageType: string, title: string, body = 'First line of the body.\nSecond line.') =>
  ({ id, title, pageType, bodyMarkdown: body, sourceCount: 3, lastUpdatedAt: new Date('2026-11-01'), scope: 'tenant' });

describe('OPT-007 the planner view', () => {
  it('lists docs with a first line, attachments by title only, and names what it leaves out', async () => {
    findMany.mockResolvedValue([
      page('p_ops', 'org_doc', 'Nexeo Operations Manual', '**Kind:** source of truth'),
      page('p_pol', 'policy', 'Leave Policy'),
      page('p_att', 'attachment_doc', 'BRD LIST OF ITL.xlsx', 'A long preview that must not be sent to the planner any more.'),
      page('p_top', 'topic', 'IP strategy'),
      page('p_per', 'entity_person', 'Umair Wasim'),
      page('p_prj', 'project', 'ITL'),
      page('p_obs', 'observation', 'New external: Hamza Shahbaz'),
      page('p_ms', 'mind_state', 'Mind State', '**Updated:** 2026-11-04'),
    ]);
    const idx = await getCompactIndexForPlanner('TMC-0001', 2);
    expect(idx).toContain('## org_doc (1)');
    expect(idx).toContain('- `p_ops` **Nexeo Operations Manual** — **Kind:** source of truth');
    expect(idx).toContain('- `p_pol` **Leave Policy** —');
    expect(idx).toContain('## attachment_doc (1) — id and title only');
    expect(idx).toContain('- `p_att` **BRD LIST OF ITL.xlsx**\n');
    expect(idx).not.toContain('A long preview that must not be sent');
    for (const id of ['p_top', 'p_per', 'p_prj', 'p_obs']) expect(idx).not.toContain(id);
    expect(idx).toContain('## not listed individually: topic (1), entity_person (1), project (1), observation (1)');
    expect(idx).toContain('Leave `openPageIds` empty for them');
    expect(idx).toContain('- `p_ms` **Mind State** — **Updated:** 2026-11-04');
    expect(findMany.mock.calls[0][0].where).toMatchObject({ clientNumber: 'TMC-0001', OR: [{ scope: 'tenant' }, { scope: 'user', userId: 2 }] });
  });

  it('stays small at the live tenant\'s shape (994 topics, 572 people, 582 projects, 451 observations, 483 attachments)', async () => {
    const rows: any[] = [];
    const add = (n: number, type: string) => { for (let i = 0; i < n; i++) rows.push(page(`${type}_${i}`, type, `${type} page ${i} with a realistic title length`, 'A body first line of about eighty characters, like the measured average per page line.')); };
    add(994, 'topic'); add(572, 'entity_person'); add(582, 'project'); add(451, 'observation'); add(483, 'attachment_doc'); add(17, 'org_doc'); add(18, 'policy');
    findMany.mockResolvedValue(rows);
    const idx = await getCompactIndexForPlanner('TMC-0001', 2);
    expect(idx.length).toBeLessThan(60_000); // was 320,754 for this shape
    expect(idx.split('\n').filter((l) => l.startsWith('- `')).length).toBe(483 + 17 + 18);
  });
});
