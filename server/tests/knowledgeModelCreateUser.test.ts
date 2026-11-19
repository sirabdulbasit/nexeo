/**
 * Client Owned Data: the model is chosen when the user is created, with the user, in one transaction
 * (founder, 19 Nov 2026; docs/Wiki-Knowledge.md §0.6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ created: [] as any[], updates: [] as any[], updateRows: 1, committed: false }));

vi.mock('bcrypt', () => { const b = { hash: async () => 'hash', hashSync: () => 'hash', compare: async () => false }; return { default: b, ...b }; });
vi.mock('../src/services/configService', () => ({ getConfig: async () => null }));
vi.mock('../src/services/inviteService', () => ({ sendPasswordChangedEmail: async () => undefined }));
vi.mock('../src/db/prisma', () => {
  const tx = {
    user: { create: vi.fn(async ({ data }: any) => { const u = { id: 41, ...data }; db.created.push(u); return u; }) },
    $executeRawUnsafe: vi.fn(async (sql: string, ...args: any[]) => { db.updates.push({ sql, args }); return db.updateRows; }),
  };
  const prisma: any = {
    $transaction: vi.fn(async (fn: any) => { db.committed = false; const r = await fn(tx); db.committed = true; return r; }),
    user: { create: vi.fn(async () => { throw new Error('created outside the transaction'); }) },
  };
  return { __esModule: true, default: prisma, prisma };
});

import { createUser } from '../src/services/authService';
import { createUserSchema } from '../src/schemas/auth';

const person = { clientNumber: 'T-1', empcode: 'E1', name: 'Ali', email: 'ali@x.com', password: 'Secret#123', userType: 'ST' };

beforeEach(() => { db.created.length = 0; db.updates.length = 0; db.updateRows = 1; db.committed = false; });

describe('createUser and the knowledge model', () => {
  it('a user is Nexeo Owned Data unless said otherwise, and no model write is made', async () => {
    const u = await createUser(person);
    expect(u.knowledgeModel).toBe('nexeo');
    expect(db.updates).toEqual([]);
    expect(db.committed).toBe(true);
  });

  it('a Client Owned Data user gets his model in the same transaction as his row', async () => {
    const u = await createUser({ ...person, knowledgeModel: 'external' });
    expect(u).toMatchObject({ id: 41, knowledgeModel: 'external' });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].sql).toMatch(/UPDATE users SET knowledge_model = \$1 WHERE id = \$2/);
    expect(db.updates[0].args).toEqual(['external', 41]);
  });

  it('if the model cannot be set, the user is not created (the transaction fails)', async () => {
    db.updateRows = 0;
    await expect(createUser({ ...person, knowledgeModel: 'external' })).rejects.toThrow('could not be set');
    expect(db.committed).toBe(false);
  });

  it('an unknown model is refused before anything is written', async () => {
    await expect(createUser({ ...person, knowledgeModel: 'obsidian' as any })).rejects.toThrow('nexeo or external');
    expect(db.created).toEqual([]);
  });

  it('the route accepts only the two models', () => {
    const body = { empcode: 'E1', name: 'Ali', email: 'ali@x.com', password: 'Secret#123', userType: 'ST' };
    expect(createUserSchema.safeParse(body).success).toBe(true);
    expect(createUserSchema.safeParse({ ...body, knowledgeModel: 'external' }).success).toBe(true);
    expect(createUserSchema.safeParse({ ...body, knowledgeModel: 'obsidian' }).success).toBe(false);
  });
});

describe('there is no setter after creation', () => {
  it('nothing in src writes knowledge_model except createUser', async () => {
    const fs = await import('fs'); const path = await import('path');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.ts$/.test(f.name)) {
          const code = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
          if (/SET\s+knowledge_model|knowledgeModel\s*:\s*(?!z\.)[^;,)]*\}\s*\)?\s*,?\s*where|update[^;]{0,200}knowledgeModel/i.test(code)) hits.push(path.relative(path.join(__dirname, '../src'), p));
        }
      }
    };
    walk(path.join(__dirname, '../src'));
    expect(hits).toEqual(['services/authService.ts']);
  });
});
