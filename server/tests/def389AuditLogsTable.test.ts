/**
 * DEF-389 — audit() inserted into audit_logs, a table that was never created, and swallowed the
 * error, so the general audit trail was silently empty. The migration must provide every column
 * audit() writes and listAuditEntries() reads, under exactly that name.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const migration = readFileSync(path.join(__dirname, '../prisma/migrations/20261104_audit_logs/migration.sql'), 'utf8');
const service = readFileSync(path.join(__dirname, '../src/services/auditLogService.ts'), 'utf8');

describe('DEF-389 audit_logs', () => {
  it('the service still names the table the migration creates', () => {
    expect(service).toContain('INSERT INTO audit_logs');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS audit_logs (');
  });
  it('has every column the INSERT writes', () => {
    const cols = service.match(/INSERT INTO audit_logs\s*\(([^)]*)\)/)![1].split(',').map((c) => c.trim());
    expect(cols).toContain('details');
    for (const c of cols) expect(migration).toMatch(new RegExp(`\\n  ${c}\\s+[A-Z]`));
  });
  it('has created_at, which the reader sorts on, and is idempotent', () => {
    expect(migration).toMatch(/\n  created_at\s+TIMESTAMP/);
    expect(migration.match(/CREATE (TABLE|INDEX) IF NOT EXISTS/g)).toHaveLength(3);
    expect(migration).not.toMatch(/\bDROP\b/);
  });
});
