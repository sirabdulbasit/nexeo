/**
 * DEF-473 — three older readers of wiki pages read every user of a client
 * (found 13 Nov 2026 by the privacy matrix, fourth outside review P2):
 *  - the concept builder wrote one user's person or topic page from every user's pages (private mail into another's page);
 *  - Brain's thinking step put colleagues' new contacts and topics into one user's observations;
 *  - the contacts clean-up route let any user see, and archive, a colleague's contacts.
 * Nothing was read: no second user of any client could sign in.
 * Now each reads one owner's pages and the company's (scope 'tenant'), or only the caller's own.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

describe('DEF-473: old wiki readers read one owner, not the whole client', () => {
  it('the concept builder reads only the owner\'s pages and the company\'s, for people and for topics', () => {
    const src = read('services/knowledge/conceptSynthesizerService.ts');
    const person = src.slice(src.indexOf('export async function synthesizePerson'), src.indexOf('async function linkFromPersonToSources'));
    const topic = src.slice(src.indexOf('export async function synthesizeTopic'), src.indexOf('async function linkTopicGraph'));
    expect(person).toMatch(/const owner = await conceptOwner\(/);
    expect(person).toMatch(/AND \(scope = 'tenant' OR user_id = \$3\)[\s\S]*clientNumber, entityId, owner/);
    expect(topic).toMatch(/AND \(scope = 'tenant' OR user_id = \$3\)[\s\S]*clientNumber, name, topicOwner/);
    expect(topic).toMatch(/const mdUser = topicOwner;/); // the page is written for the same user it was read for
  });

  it('Brain\'s observations of new contacts and rising topics are the user\'s own', () => {
    const src = read('services/knowledge/brainCognitiveEngine.ts');
    const contacts = src.slice(src.indexOf('async function analyzeNewContacts'), src.indexOf('async function analyzeRisingTopics'));
    const topics = src.slice(src.indexOf('async function analyzeRisingTopics'));
    expect(contacts).toMatch(/AND \(scope = 'tenant' OR user_id = \$3\)[\s\S]*clientNumber, oneDayAgo, userId/);
    expect(topics.slice(0, 1200)).toMatch(/AND \(wp\.scope = 'tenant' OR wp\.user_id = \$3\)[\s\S]*clientNumber, sevenDaysAgo, userId/);
  });

  it('the contacts clean-up route touches only the caller\'s own contacts', () => {
    const src = read('routes/entityCatalogRoutes.ts');
    const route = src.slice(src.indexOf("router.post('/cleanup-junk'"), src.indexOf('router.', src.indexOf("router.post('/cleanup-junk'") + 10));
    expect(route).toMatch(/AND user_id = \$2`,\s*req\.user!\.clientNumber, req\.user!\.id/);
  });
});
