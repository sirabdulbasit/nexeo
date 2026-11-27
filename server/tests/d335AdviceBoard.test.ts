/**
 * D-335 (founder 27 Nov 12:47, through Suzi: "Suzi should also suggest what to do with these emails, like ignore,
 * forward, reply (and what to reply etc)", "and similarly with Task"; Suzi-Builder 12:49 and 13:10).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/prisma', () => ({ default: {} }));
const wiki = vi.hoisted(() => ({ note: null as any, writes: 0 }));
vi.mock('../src/services/wiki/wikiStore', () => ({
  getNote: vi.fn(async () => wiki.note),
  writeNote: vi.fn(async (n: any) => { wiki.note = { properties: n.properties, title: n.title, type: n.type }; wiki.writes += 1; }),
}));

import { itemAdvise, parseItemAdvice, advisePrompt, clearItemAdviceCache, warmItemAdvice, loadKept, saveKept, adviceText, ITEM_SYSTEM, SIGNATURE, KEPT_TITLE, CACHE_MS, type Gathered } from '../src/services/suzi/itemAdvice';

const G = (o: Partial<Gathered> = {}): Gathered => ({
  kind: 'email', id: 'th1', state: '2|2026-11-27', threadId: 'th1', item: 'EMAIL THREAD "Tridorian invoice INV-4770" ...',
  people: [{ ref: 'person:1', id: 'p-salman', name: 'Salman Sohail', email: 'salman@x.com' }],
  notes: [], tasks: [], decisions: [{ ref: 'decision:1', line: '2026-11-23 him: Forwarded "Tridorian reminder" to salman@x.com' }], rules: [], goals: [], missing: [], ...o,
});
const J = (o: any) => JSON.stringify(o);
const base = { what: 'Reply: ask Salman whether INV-4770 was paid', how: ['"Salman, has INV-4770 been paid? Tridorian sent a reminder."', 'Sign off as \'Basit Twin\' as per your rules.'], suggest: { action: 'reply' }, rests_on: ['item', 'decision:1'], missing: ['Whether INV-4770 was paid isn\'t known'] };
beforeEach(() => { clearItemAdviceCache(); wiki.note = null; wiki.writes = 0; });

describe('D-335 what the advice says', () => {
  it('the instructions ask for the action first, the reply\'s words, no sign-off, no fact that is not on record', () => {
    for (const p of ['"Reply: …"', '"Forward to <name>: …"', '"Delegate to <name>: …"', '"Ignore: …"', '"No action: you\'re in copy"', '"Follow up with <name>: …"']) expect(ITEM_SYSTEM).toContain(p);
    expect(ITEM_SYSTEM).toMatch(/the FIRST step is what to say: one or two sentences of the reply itself/);
    expect(ITEM_SYSTEM).toMatch(/Never add a step about a signature or how to sign off/);
    expect(ITEM_SYSTEM).toMatch(/NEVER state as true or done something the record does not show/);
    expect(ITEM_SYSTEM).toMatch(/the step is to confirm it/);
  });
  it('a sign-off step never reaches him; an ordinary "sign" stays', () => {
    const g = G();
    const a = parseItemAdvice(J(base), g, advisePrompt(g).refs)!;
    expect(a.how).toEqual(['"Salman, has INV-4770 been paid? Tridorian sent a reminder."']);
    expect(a.what.startsWith('Reply: ')).toBe(true);
    expect(a.complete).toBe(false);
    for (const t of ['Sign off as Basit Twin', 'ends with the signature Basit Twin', 'Signed as Basit', 'Use the sign-off from your rules']) expect(SIGNATURE.test(t)).toBe(true);
    for (const t of ['Ask him to sign it by Friday', 'Get the contract signed', 'Send the design to Salman']) expect(SIGNATURE.test(t)).toBe(false);
  });
  it('Ignore and No action have their buttons', () => {
    const g = G();
    expect(parseItemAdvice(J({ ...base, what: 'Ignore: a vendor newsletter', suggest: { action: 'ignore' } }), g, advisePrompt(g).refs)!.suggest)
      .toEqual({ op: 'email.mark', args: { thread_id: 'th1', state: 'no_reply_needed' }, label: 'Ignore' });
    expect(parseItemAdvice(J({ ...base, what: 'No action: you\'re in copy', suggest: { action: 'mark_handled' } }), g, advisePrompt(g).refs)!.suggest)
      .toEqual({ op: 'email.mark', args: { thread_id: 'th1', state: 'handled' }, label: 'Mark as handled' });
    // Nothing to do needs no steps; anything else without steps is not advice.
    expect(parseItemAdvice(J({ ...base, what: 'No action: you\'re in copy', how: [], suggest: { action: 'mark_handled' } }), g, advisePrompt(g).refs)!.how).toEqual([]);
    expect(parseItemAdvice(J({ ...base, how: [] }), g, advisePrompt(g).refs)).toBeNull();
    expect(ITEM_SYSTEM).toMatch(/never when the item says it is addressed to them/);
    expect(ITEM_SYSTEM).toMatch(/never "Wait"/);
  });
});

describe('D-335 every card, and the same answer until the item changes', () => {
  it('prepares every email, every For-your-knowledge email and every open task, each once', async () => {
    const asked: string[] = [];
    const advise = vi.fn(async (_c: string, _u: number, a: any) => { asked.push(`${a.kind}:${a.id}`); return { ok: true, item: {} } as any; });
    const items = async () => ({
      emails: [{ thread_id: 'e1', from: 'A', subject: 's', received_at: '2026-11-27T05:00:00Z', critical: false }],
      fyi: [{ thread_id: 'f1', email_id: 'm1' }, { thread_id: 'e1', email_id: 'm2' }],
      actions: [{ id: 't1', title: 'T1', owner: 'me', due: null, overdue: false }, { id: 't2', title: 'T2', owner: 'Yousuf', due: '2026-11-20', overdue: true }],
    });
    const r = await warmItemAdvice('T', 2, { advise: advise as any, items, now: new Date('2026-11-27T07:00:00Z') });
    expect(asked.sort()).toEqual(['email:e1', 'email:f1', 'task:t1', 'task:t2']);
    expect(r).toEqual({ items: 4, prepared: 4, failed: 0 });
  });
  it('an unchanged item gets the same answer after a restart, with no new thinking', async () => {
    const llm = vi.fn(async () => J(base));
    const gather = (async () => G()) as any;
    const now = new Date('2026-11-27T07:00:00Z');
    const a: any = await itemAdvise('T', 2, { kind: 'email', id: 'th1' }, { llm, gather, now });
    expect(await saveKept('T', 2)).toBe(true);
    expect(wiki.note.title).toBe(KEPT_TITLE);
    expect(wiki.note.type).toBe('learned');
    expect(await saveKept('T', 2)).toBe(false); // nothing changed: nothing written
    clearItemAdviceCache(); // the restart
    expect(adviceText(a.item.id)).toBeNull();
    expect(await loadKept('T', 2)).toBe(1);
    expect(adviceText(a.item.id)).toBe(a.item.what);
    const later = new Date(now.getTime() + 20 * 3600_000);
    const b: any = await itemAdvise('T', 2, { kind: 'email', id: 'th1' }, { llm: async () => J({ ...base, what: 'Reply: something else entirely' }), gather, now: later });
    expect(b.item).toEqual(a.item);
    expect(llm).toHaveBeenCalledTimes(1);
  });
  it('a changed item, or one unchanged for longer than the keep time, is thought about again', async () => {
    const now = new Date('2026-11-27T07:00:00Z');
    const a: any = await itemAdvise('T', 2, { kind: 'email', id: 'th1' }, { llm: async () => J(base), gather: (async () => G()) as any, now });
    const next = async () => J({ ...base, what: 'Reply: thank Salman, it is paid' });
    const changed: any = await itemAdvise('T', 2, { kind: 'email', id: 'th1' }, { llm: next, gather: (async () => G({ state: '3|2026-11-28' })) as any, now: new Date(now.getTime() + 3600_000) });
    expect(changed.item.what).not.toBe(a.item.what);
    clearItemAdviceCache();
    const c: any = await itemAdvise('T', 2, { kind: 'email', id: 'th1' }, { llm: async () => J(base), gather: (async () => G()) as any, now });
    const old: any = await itemAdvise('T', 2, { kind: 'email', id: 'th1' }, { llm: next, gather: (async () => G()) as any, now: new Date(now.getTime() + CACHE_MS + 60_000) });
    expect(old.item.what).not.toBe(c.item.what);
  });
});
