/**
 * T56 (founder 27 Nov): Email signature and Assistant settings live in Nexeo's Settings, not in Suzi. Pinned:
 *  1. phrases are letters and spaces, 2..40, lower-cased; sleep phrases come as a list or one comma line, max 10;
 *  2. what she calls him is the name he set, else his first name;
 *  3. a wrong field writes nothing at all; right fields write only what was sent;
 *  4. phrases and the signature go to his Wiki profile note, marked as his Settings (not "Suzi learned");
 *  5. the pack leaves out a phrase never set, so Suzi keeps her own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const exec = vi.fn();
vi.mock('../src/db/prisma', () => ({ default: { $queryRawUnsafe: (...a: any[]) => query(...a), $executeRawUnsafe: (...a: any[]) => exec(...a) } }));
const setName = vi.fn();
vi.mock('../src/services/suzi/suziProfile', () => ({
  getAssistantName: async () => 'Suzi',
  setAssistantName: (...a: any[]) => setName(...a),
}));
const runW1Op = vi.fn();
const profileOf = vi.fn();
vi.mock('../src/services/suzi/suziW1', () => ({ runW1Op: (...a: any[]) => runW1Op(...a), profileOf: (...a: any[]) => profileOf(...a) }));

import {
  getAssistantSettings, packAssistant, phraseOf, saveAssistantSettings, sleepPhrasesOf, userNameOf,
} from '../src/services/suzi/assistantSettings';

beforeEach(() => {
  query.mockReset(); exec.mockReset(); setName.mockReset(); runW1Op.mockReset(); profileOf.mockReset();
  query.mockResolvedValue([{ name: 'Basit Ahmed', title: 'Sir' }]);
  setName.mockResolvedValue(true);
  runW1Op.mockResolvedValue({ ok: true });
  profileOf.mockResolvedValue(null);
});

describe('phrases', () => {
  it('a phrase is letters and spaces, 2 to 40, lower-cased; empty means not set', () => {
    expect(phraseOf('  Hey   Sue Zee ')).toBe('hey sue zee');
    expect(phraseOf('')).toBe('');
    expect(phraseOf('x')).toBeNull();
    expect(phraseOf('hey suzi!')).toBeNull();
    expect(phraseOf('a'.repeat(41))).toBeNull();
  });
  it('sleep phrases: list or comma line, duplicates once, at most 10, one bad phrase refuses all', () => {
    expect(sleepPhrasesOf('Thank you, bye suzi, , bye suzi')).toEqual(['thank you', 'bye suzi']);
    expect(sleepPhrasesOf(['That is all'])).toEqual(['that is all']);
    expect(sleepPhrasesOf('ok, stop!')).toBeNull();
    expect(sleepPhrasesOf(Array.from({ length: 11 }, (_, i) => `bye ${'a'.repeat(i + 1)}`))).toBeNull();
  });
  it('what she calls him: the name he set, else his first name', () => {
    expect(userNameOf('Sir', 'Basit Ahmed')).toBe('Sir');
    expect(userNameOf('  ', 'Basit Ahmed')).toBe('Basit');
    expect(userNameOf(null, '')).toBe('there');
  });
});

describe('saving', () => {
  it('a wrong field writes nothing at all', async () => {
    const r = await saveAssistantSettings('T', 2, { name: 'Suzi', wake_phrase: 'hey!', signature: 'Basit' });
    expect(r).toEqual({ ok: false, field: 'wake_phrase', error: expect.any(String) });
    expect(setName).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(runW1Op).not.toHaveBeenCalled();
  });
  it('a signature over 500 characters is refused', async () => {
    const r = await saveAssistantSettings('T', 2, { signature: 'x'.repeat(501) });
    expect(r.ok).toBe(false);
    expect(runW1Op).not.toHaveBeenCalled();
  });
  it('phrases and the signature go to his profile note, marked as his Settings', async () => {
    const r = await saveAssistantSettings('T', 2, { wake_phrase: 'Hey Sue Zee', sleep_phrases: 'thank you, bye', signature: 'Regards\r\nBasit' });
    expect(r.ok).toBe(true);
    const [cn, uid, op, args, confirmed, gate] = runW1Op.mock.calls[0];
    expect([cn, uid, op, confirmed]).toEqual(['T', 2, 'profile.update', true]);
    expect(gate).toEqual({ signatureVerified: false, from: 'settings' });
    expect(args.notes.map((n: any) => [n.key, n.value])).toEqual([
      ['assistant.wake_phrase', 'hey sue zee'], ['assistant.sleep_phrases', ['thank you', 'bye']], ['email.signature', 'Regards\nBasit'],
    ]);
    expect(setName).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });
  it('an emptied field is forgotten (empty value), so Suzi keeps her own', async () => {
    await saveAssistantSettings('T', 2, { wake_phrase: '', sleep_phrases: '' });
    expect(runW1Op.mock.calls[0][3].notes.map((n: any) => n.value)).toEqual(['', '']);
  });
  it('her name and what she calls him go to their old records, for this user and tenant only', async () => {
    await saveAssistantSettings('TMC-0001', 2, { name: 'Suzi', user_name: 'Basit' });
    expect(setName).toHaveBeenCalledWith('TMC-0001', 2, 'Suzi');
    expect(exec.mock.calls[0][0]).toContain("'{profile,preferredTitle}'");
    expect(exec.mock.calls[0].slice(1)).toEqual(['Basit', 2, 'TMC-0001']);
    expect(runW1Op).not.toHaveBeenCalled();
  });
});

describe('reading and the pack', () => {
  it('reads all five from their records', async () => {
    profileOf.mockResolvedValue({ 'assistant.wake_phrase': 'hey sue zee', 'assistant.sleep_phrases': ['bye'], 'email.signature': 'Basit' });
    expect(await getAssistantSettings('T', 2)).toEqual({ name: 'Suzi', user_name: 'Sir', wake_phrase: 'hey sue zee', sleep_phrases: ['bye'], signature: 'Basit' });
  });
  it('the pack leaves out a phrase never set', () => {
    expect(packAssistant({ name: 'Suzi', user_name: 'Sir', wake_phrase: null, sleep_phrases: [], signature: null }))
      .toEqual({ name: 'Suzi', user_name: 'Sir' });
    expect(packAssistant({ name: 'Suzi', user_name: 'Sir', wake_phrase: 'hey sue zee', sleep_phrases: ['bye'], signature: 'B' }))
      .toEqual({ name: 'Suzi', user_name: 'Sir', wake_phrase: 'hey sue zee', sleep_phrases: ['bye'] });
  });
});
