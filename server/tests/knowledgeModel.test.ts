/**
 * Client Owned Data (founder, 19 Nov 2026; Functional Charter "Obsidian vault: Client Owned Data";
 * docs/Wiki-Knowledge.md §0.6): for an external-knowledge user nothing is stored in the Nexeo wiki
 * except his identity and what was learned about how he works; the guard fails closed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  users: new Map<number, { client: string; model: string }>(),
  fail: false,
  writes: [] as string[],
}));

vi.mock('../src/db/prisma', () => {
  const $queryRawUnsafe = vi.fn(async (sql: string, ...args: any[]) => {
    if (db.fail) throw new Error('database down');
    if (/SELECT knowledge_model FROM users/.test(sql)) {
      const u = db.users.get(Number(args[0]));
      return u && u.client === args[1] ? [{ knowledge_model: u.model }] : [];
    }
    if (/SELECT id FROM users WHERE knowledge_model <> 'nexeo'/.test(sql)) {
      return [...db.users.entries()].filter(([, u]) => u.model !== 'nexeo' && (args[0] === undefined || u.client === args[0])).map(([id]) => ({ id }));
    }
    if (/knowledge_model = 'nexeo' ORDER BY id LIMIT 1/.test(sql)) {
      return [...db.users.entries()].filter(([, u]) => u.model === 'nexeo' && u.client === args[0]).sort((a, b) => a[0] - b[0]).slice(0, 1).map(([id]) => ({ id }));
    }
    return [];
  });
  const prisma: any = {
    $queryRawUnsafe,
    $transaction: vi.fn(async () => { db.writes.push('transaction'); throw new Error('reached the store'); }),
    feedEvent: { findMany: vi.fn(async () => { db.writes.push('feed read'); return []; }) },
  };
  return { __esModule: true, default: prisma, prisma };
});

import {
  isExternalKnowledge, knowledgeModelOf, externalUserIds, externalKnowledgeBody, EXTERNAL_KNOWLEDGE,
  sourceStaysInNexeo, noteStaysInNexeo, ExternalKnowledgeRefused, isKnowledgeModel,
} from '../src/services/wiki/knowledgeModel';

beforeEach(() => {
  db.users.clear(); db.fail = false; db.writes.length = 0;
  db.users.set(2, { client: 'T-1', model: 'nexeo' });
  db.users.set(9, { client: 'T-1', model: 'external' });
  db.users.set(11, { client: 'T-2', model: 'external' });
});

describe('the guard', () => {
  it('answers from the user row', async () => {
    expect(await isExternalKnowledge('T-1', 2)).toBe(false);
    expect(await isExternalKnowledge('T-1', 9)).toBe(true);
    expect(await knowledgeModelOf('T-1', 9)).toBe('external');
  });

  it('fails closed: no row, another client, a bad id, an unknown value, a database error', async () => {
    expect(await isExternalKnowledge('T-1', 404)).toBe(true);
    expect(await isExternalKnowledge('T-2', 2)).toBe(true); // user 2 belongs to T-1
    expect(await isExternalKnowledge('', 2)).toBe(true);
    expect(await isExternalKnowledge('T-1', 0)).toBe(true);
    expect(await isExternalKnowledge('T-1', Number.NaN)).toBe(true);
    db.users.set(5, { client: 'T-1', model: 'something-new' });
    expect(await isExternalKnowledge('T-1', 5)).toBe(true);
    db.fail = true;
    expect(await isExternalKnowledge('T-1', 2)).toBe(true);
    expect(await knowledgeModelOf('T-1', 2)).toBeNull();
  });

  it('lists the external users in one query, and throws when the list cannot be read', async () => {
    expect([...(await externalUserIds())].sort((a, b) => a - b)).toEqual([9, 11]);
    expect([...(await externalUserIds('T-1'))]).toEqual([9]);
    db.fail = true;
    await expect(externalUserIds()).rejects.toThrow('database down');
  });

  it('the route body is exactly the agreed one', () => {
    expect(externalKnowledgeBody()).toEqual({ external_knowledge: true, knowledge_model: 'external', message: 'Your knowledge is in your Obsidian vault' });
    expect(EXTERNAL_KNOWLEDGE).toBe('external_knowledge');
    expect(isKnowledgeModel('external')).toBe(true);
    expect(isKnowledgeModel('obsidian')).toBe(false);
  });
});

describe('what stays in Nexeo for a Client Owned Data user', () => {
  it('his identity, his profile lines and the learned rows; nothing else', () => {
    expect(sourceStaysInNexeo({ kind: 'record', details: { type: 'identity', kind: 'voiceprint' } })).toBe(true);
    expect(sourceStaysInNexeo({ kind: 'record', details: { type: 'profile', key: 'tone' } })).toBe(true);
    expect(sourceStaysInNexeo({ kind: 'record', details: { store: 'user_memories' } })).toBe(true);
    expect(sourceStaysInNexeo({ kind: 'record', details: { store: 'kpi_readings' } })).toBe(false);
    expect(sourceStaysInNexeo({ kind: 'record', details: { type: 'device_report' } })).toBe(false);
    expect(sourceStaysInNexeo({ kind: 'record', details: {} })).toBe(false);
    for (const kind of ['email', 'calendar', 'chat', 'whatsapp', 'task', 'transcript', 'attachment', 'document', 'conversation']) {
      // A mail dressed up with a profile detail is still a mail.
      expect(sourceStaysInNexeo({ kind, details: { type: 'profile' } })).toBe(false);
    }
  });

  it('his "How to work with" note and learned notes; no other note, and not another user\'s profile id', () => {
    expect(noteStaysInNexeo({ type: 'learned', userId: 9 })).toBe(true);
    expect(noteStaysInNexeo({ type: 'person', ids: ['profile:user:9'], userId: 9 })).toBe(true);
    expect(noteStaysInNexeo({ type: 'person', ids: ['profile:user:2'], userId: 9 })).toBe(false);
    expect(noteStaysInNexeo({ type: 'person', ids: ['profile:user:9', 'email:ali@x.com'], userId: 9 })).toBe(false);
    expect(noteStaysInNexeo({ type: 'person', ids: ['email:ali@x.com'], userId: 9 })).toBe(false);
    for (const type of ['company', 'project', 'topic', 'meeting', 'decision', 'commitment', 'document', 'rule', 'conversation', 'system', 'kpi'])
      expect(noteStaysInNexeo({ type, ids: ['profile:user:9'], userId: 9 })).toBe(false);
  });
});

describe('the Wiki doors refuse before anything is written', () => {
  it('saveSource: every kind of his own data is refused; the store is never reached', async () => {
    const { saveSource } = await import('../src/services/wiki/wikiSources');
    for (const kind of ['email', 'calendar', 'chat', 'whatsapp', 'task', 'transcript', 'attachment', 'conversation'] as const) {
      await expect(saveSource({ clientNumber: 'T-1', userId: 9, kind, externalId: `x-${kind}`, body: 'his data' })).rejects.toBeInstanceOf(ExternalKnowledgeRefused);
    }
    await expect(saveSource({ clientNumber: 'T-1', userId: 9, kind: 'record', scope: 'tenant', externalId: 'kpi:sales', body: 'company number' })).rejects.toBeInstanceOf(ExternalKnowledgeRefused);
    await expect(saveSource({ clientNumber: 'T-1', userId: 9, kind: 'record', externalId: 'device-report:mac:2026-11-19', details: { type: 'device_report' } })).rejects.toBeInstanceOf(ExternalKnowledgeRefused);
    expect(db.writes).toEqual([]);
  });

  it('saveSource: his identity and profile go through to the store; a Nexeo user is untouched', async () => {
    const { saveSource } = await import('../src/services/wiki/wikiSources');
    await expect(saveSource({ clientNumber: 'T-1', userId: 9, kind: 'record', externalId: 'profile:tone', body: 'short', details: { type: 'profile', key: 'tone' } })).rejects.toThrow('reached the store');
    await expect(saveSource({ clientNumber: 'T-1', userId: 2, kind: 'email', externalId: 'm1', body: 'hello' })).rejects.toThrow('reached the store');
    expect(db.writes).toEqual(['transaction', 'transaction']);
  });

  it('saveSource: a user whose model cannot be read is refused (fails closed)', async () => {
    const { saveSource } = await import('../src/services/wiki/wikiSources');
    db.fail = true;
    await expect(saveSource({ clientNumber: 'T-1', userId: 2, kind: 'email', externalId: 'm1', body: 'hello' })).rejects.toBeInstanceOf(ExternalKnowledgeRefused);
    expect(db.writes).toEqual([]);
  });

  it('writeNote: his notes are refused; his profile note and learned notes go through', async () => {
    const { writeNote } = await import('../src/services/wiki/wikiStore');
    const base = { clientNumber: 'T-1', userId: 9, title: 'X', body: 'b', actor: 'test' } as any;
    for (const type of ['person', 'company', 'project', 'commitment', 'decision', 'meeting', 'document', 'rule', 'conversation'])
      await expect(writeNote({ ...base, type })).rejects.toBeInstanceOf(ExternalKnowledgeRefused);
    await expect(writeNote({ ...base, type: 'system', scope: 'tenant' })).rejects.toBeInstanceOf(ExternalKnowledgeRefused);
    expect(db.writes).toEqual([]);
    await expect(writeNote({ ...base, type: 'learned' })).rejects.toThrow('reached the store');
    await expect(writeNote({ ...base, type: 'person', ids: ['profile:user:9'] })).rejects.toThrow('reached the store');
    await expect(writeNote({ ...base, userId: 2, type: 'company' })).rejects.toThrow('reached the store');
  });
});

describe('the hourly work skips him', () => {
  it('reconcile lands nothing and does not even read his feed items', async () => {
    const { reconcileSources } = await import('../src/services/wiki/wikiBackfill');
    const r = await reconcileSources('T-1', 9);
    expect(r).toMatchObject({ external: true, feedItems: 0, landed: 0, missing: 0 });
    expect(db.writes).toEqual([]);
  });

  it('a dry-run build for him reads nothing and builds nothing', async () => {
    const { rebuildWikiForUser } = await import('../src/services/wiki/wikiBuilder');
    const r = await rebuildWikiForUser('T-1', 9, { dryRun: true });
    expect(r).toMatchObject({ external: true, items: 0, notes: [], written: 0, learned: null });
    expect(db.writes).toEqual([]);
  });

  it('the company notes are never written in his name', async () => {
    const { sharedWriter } = await import('../src/services/wiki/wikiSystems');
    expect(await sharedWriter('T-1')).toBe(2);
    expect(await sharedWriter('T-2')).toBeNull(); // T-2 has only a Client Owned Data user
  });
});
