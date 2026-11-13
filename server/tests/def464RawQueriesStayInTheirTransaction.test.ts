/**
 * DEF-464 — a raw statement inside a transaction ran outside it.
 *
 * Measured on the production database, 13 Nov 2026, with the project's client:
 * inside `prisma.$transaction(async (tx) => …)`, `tx.$queryRawUnsafe` did not see
 * a row the same transaction had just created, and a row written with
 * `tx.$executeRawUnsafe` survived the rollback. An untouched Prisma client did
 * both correctly. Twelve files run raw statements inside transactions.
 *
 * Cause (src/db/prisma.ts, rawQueryObservability.ts, rawParamSanitizer.ts): both
 * wrappers were `(...args) => original.bind(client)(...args)`, and were
 * re-installed on every `tx`. A `tx` is a proxy over the client, so the method
 * read off it was the client's wrapper, already bound to the client.
 *
 * Criteria:
 *  1. a raw operation called on a transaction client runs on that transaction;
 *  2. called on the client, or read off it and called on its own, it runs on the client;
 *  3. both wrappers still do their job on a transactional call (observe, sanitize);
 *  4. nothing is installed per transaction, so the wrappers never stack;
 *  5. neither wrapper binds the operation to the client it was installed on.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('../src/utils/logger', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { __esModule: true, default: () => log, createLogger: () => log };
});

import { installRawQueryObservers, callerOf, OBSERVED_RAW_OPERATIONS } from '../src/db/rawQueryObservability';
import { installRawParamSanitizers } from '../src/db/rawParamSanitizer';

/** A client whose raw operations report which connection they ran on, as Prisma's do through `this`. */
function makeClient() {
  const ran: Array<{ op: string; on: string; args: unknown[] }> = [];
  class Client {
    conn = 'main';
    async $queryRawUnsafe(...args: unknown[]) { ran.push({ op: '$queryRawUnsafe', on: this.conn, args }); return this.conn; }
    async $executeRawUnsafe(...args: unknown[]) { ran.push({ op: '$executeRawUnsafe', on: this.conn, args }); return this.conn; }
    async $queryRaw(...args: unknown[]) { ran.push({ op: '$queryRaw', on: this.conn, args }); return this.conn; }
    async $executeRaw(...args: unknown[]) { ran.push({ op: '$executeRaw', on: this.conn, args }); return this.conn; }
  }
  const client: Record<string, any> = new Client();
  /** What Prisma hands a `$transaction` callback: a proxy over the same client that carries the transaction. */
  const transaction = (id: string): Record<string, any> =>
    new Proxy(client, { get: (target, prop, receiver) => (prop === 'conn' ? id : Reflect.get(target, prop, receiver)) });
  return { client, transaction, ran };
}

function installBoth(client: Record<string, any>) {
  const observed: string[] = [];
  const a = installRawQueryObservers(client, (args) => { observed.push(String((args as unknown[])[0])); return String((args as unknown[])[0]); });
  const b = installRawParamSanitizers(client, OBSERVED_RAW_OPERATIONS);
  return { observed, wrapped: [a, b] };
}

describe('DEF-464: a raw statement stays in the transaction it was issued on', () => {
  it('1. called on a transaction client, every raw operation runs on that transaction', async () => {
    const { client, transaction } = makeClient();
    expect(installBoth(client).wrapped).toEqual([4, 4]);
    const tx = transaction('tx-1');
    for (const op of OBSERVED_RAW_OPERATIONS) expect(await tx[op]('SELECT 1'), op).toBe('tx-1');
  });

  it('2. called on the client, or read off it and called on its own, it runs on the client', async () => {
    const { client } = makeClient();
    installBoth(client);
    expect(await client.$queryRawUnsafe('SELECT 1')).toBe('main');
    const detached = client.$executeRawUnsafe;
    expect(await detached('SELECT 1')).toBe('main');
    expect(callerOf(undefined, '$queryRawUnsafe', client)).toBe(client);
    expect(callerOf({ unrelated: true }, '$queryRawUnsafe', client)).toBe(client);
  });

  it('3. a transactional call is still observed and its parameters still cleaned', async () => {
    const { client, transaction, ran } = makeClient();
    const { observed } = installBoth(client);
    await transaction('tx-2').$executeRawUnsafe('INSERT INTO t VALUES ($1)', 'a\u0000b');
    expect(observed).toEqual(['INSERT INTO t VALUES ($1)']);
    expect(ran).toEqual([{ op: '$executeRawUnsafe', on: 'tx-2', args: ['INSERT INTO t VALUES ($1)', 'ab'] }]);
  });

  it('4. two transactions one after the other: each on its own, and nothing stacks on the client', async () => {
    const { client, transaction, ran } = makeClient();
    const { observed } = installBoth(client);
    const wrapper = client.$queryRawUnsafe;
    expect(await transaction('tx-a').$queryRawUnsafe('A')).toBe('tx-a');
    expect(await transaction('tx-b').$queryRawUnsafe('B')).toBe('tx-b');
    expect(await client.$queryRawUnsafe('C')).toBe('main');
    expect(client.$queryRawUnsafe).toBe(wrapper); // the client's method is the one installed at boot, still
    expect(observed).toEqual(['A', 'B', 'C']); // each statement observed once, not once per earlier transaction
    expect(ran.map((r) => r.on)).toEqual(['tx-a', 'tx-b', 'main']);
  });

  it('5. the source: no wrapper binds to its client, and nothing is installed on a tx', () => {
    const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'src', 'db', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(read('rawQueryObservability.ts')).not.toMatch(/\.bind\(client\)/);
    expect(read('rawParamSanitizer.ts')).not.toMatch(/\.bind\(client\)/);
    const prismaSrc = read('prisma.ts');
    expect(prismaSrc).not.toMatch(/install\w+\(tx/);
    expect(prismaSrc).not.toMatch(/\$transaction\s*=/);
  });
});
