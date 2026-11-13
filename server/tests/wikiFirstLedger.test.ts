/**
 * Wiki first (docs/Wiki-Knowledge.md §0, AGENTS.md invariant 9): nothing is
 * stored outside the Wiki. This test is the account of that rule.
 *
 *  1. Every table the schema or a migration defines is named in the ledger,
 *     so a new store cannot be added without saying what it holds and where
 *     it goes in the Wiki.
 *  2. The number of stores still outside the Wiki can only fall. To add one,
 *     a ceiling below has to be raised by hand, which is the rule being broken
 *     in plain sight.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {}, prisma: {} }));

import { WIKI_LEDGER, ledgerEntry, OUTSIDE_KINDS } from '../src/services/wiki/wikiLedger';

const SERVER = path.join(__dirname, '..');

function schemaTables(): string[] {
  const schema = fs.readFileSync(path.join(SERVER, 'prisma/schema.prisma'), 'utf8');
  return [...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1]).sort();
}

function migrationTables(): string[] {
  const dir = path.join(SERVER, 'prisma/migrations');
  const out = new Set<string>();
  for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d, 'migration.sql');
    if (!fs.existsSync(f)) continue;
    // Comment lines mention CREATE TABLE in prose; only statements count.
    const sql = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_0-9]+)"?/gi)) out.add(m[1]);
  }
  return [...out].sort();
}

/** Created by an old migration and dropped since; not in the database. */
const DROPPED = [
  'agent_config_overrides', 'agent_templates', 'api_keys', 'api_key_usage', 'gcp_billing_daily',
  'gcp_billing_label_daily', 'gcp_billing_sync', 'marketplace_connectors', 'marketplace_installations',
  'open_item_embeddings', 'user_memory',
];

describe('Wiki first: the ledger of every store', () => {
  it('names every table the schema defines', () => {
    expect(schemaTables().filter((t) => !ledgerEntry(t)), 'a table with no ledger entry: say what it holds and where it goes in the Wiki').toEqual([]);
  });

  it('names every table a migration creates', () => {
    const unnamed = migrationTables().filter((t) => !ledgerEntry(t) && !DROPPED.includes(t));
    expect(unnamed, 'a migration creates a table the ledger does not name').toEqual([]);
  });

  it('treats a backup copy as a leftover by its name', () => {
    expect(ledgerEntry('open_items_wipe_1779550117977')?.kind).toBe('leftover');
    expect(ledgerEntry('wiki_pages_repointed_v3_2026_05_25')?.kind).toBe('leftover');
    expect(ledgerEntry('some_new_store')).toBeNull();
  });

  it('the stores still outside the Wiki can only go down', () => {
    const count = (kind: string) => Object.values(WIKI_LEDGER).filter((e) => e.kind === kind).length;
    // Ceilings on 2026-11-13. Lower them as stores move in; never raise them.
    expect(count('knowledge')).toBeLessThanOrEqual(70);
    expect(count('trail')).toBeLessThanOrEqual(34);
    expect(count('setup')).toBeLessThanOrEqual(24);
    expect(count('working')).toBeLessThanOrEqual(10);
    expect(count('wiki')).toBe(5);
    expect(OUTSIDE_KINDS).toEqual(['knowledge', 'trail', 'setup']);
  });

  it('every entry says where it goes', () => {
    for (const [table, e] of Object.entries(WIKI_LEDGER)) expect(e.to.length, table).toBeGreaterThan(10);
  });
});
