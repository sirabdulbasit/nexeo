/**
 * DEF-475 (CL-091): an invitation he has answered leaves My Attention; one he has not answered stays and says so.
 * A calendar that cannot be read changes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const s = vi.hoisted(() => ({ events: [] as any[], error: undefined as string | undefined, calls: 0 }));
vi.mock('../src/services/calendarService', () => ({ getEvents: async () => { s.calls++; return { events: s.events, error: s.error }; } }));

import { markInviteResponses, inviteTitle, _resetInviteCache } from '../src/services/triage/inviteResponses';
import { placeItem } from '../src/services/triage/triageSuggester';

const SUBJ = 'Invitation: PMS System Demo - Vision Metrics @ Mon Nov 16, 2026 11am - 12pm (GMT+5) (Basit Ahmed)';
const card = (subject = SUBJ): any => ({ itemType: 'email', subject, needsYou: true, forYourKnowledge: null, conversationSummary: 'A new meeting invitation from Sofia Rana.' });
beforeEach(() => { _resetInviteCache(); s.events = []; s.error = undefined; s.calls = 0; });

describe('DEF-475 answered invitations', () => {
  it('reads the event title out of the subject', () => {
    expect(inviteTitle(SUBJ)).toBe('PMS System Demo - Vision Metrics');
    expect(inviteTitle('Updated invitation: Weekly sync @ Tue')).toBe('Weekly sync');
    expect(inviteTitle('Fwd: REGISTRATION REQUEST FOR GREEN BELT')).toBeNull();
  });
  it('accepted: filed as handled, not My Attention', async () => {
    s.events = [{ title: 'PMS System Demo - Vision Metrics', selfResponse: 'accepted' }];
    const c = card(); await markInviteResponses([c], 2);
    expect(c.inviteResponse).toBe('accepted'); expect(placeItem(c)).toBe('copied');
  });
  it('declined or maybe: also handled', async () => {
    for (const r of ['declined', 'tentative']) {
      _resetInviteCache(); s.events = [{ title: 'PMS System Demo - Vision Metrics', selfResponse: r }];
      const c = card(); await markInviteResponses([c], 2); expect(placeItem(c)).toBe('copied');
    }
  });
  it('not answered: stays, and says he has not replied', async () => {
    s.events = [{ title: 'PMS System Demo - Vision Metrics', selfResponse: 'needsAction' }];
    const c = card(); await markInviteResponses([c], 2);
    expect(placeItem(c)).toBe('attention'); expect(c.conversationSummary).toMatch(/^You haven't replied to this invitation yet\./);
  });
  it('calendar unreadable or no matching event: nothing changes', async () => {
    s.error = 'not connected';
    const a = card(); await markInviteResponses([a], 2); expect(placeItem(a)).toBe('attention'); expect(a.inviteResponse).toBeUndefined();
    _resetInviteCache(); s.error = undefined; s.events = [{ title: 'Something else', selfResponse: 'accepted' }];
    const b = card(); await markInviteResponses([b], 2); expect(placeItem(b)).toBe('attention');
  });
  it('a normal email never reads the calendar', async () => {
    await markInviteResponses([card('Fwd: REGISTRATION REQUEST FOR GREEN BELT')], 2);
    expect(s.calls).toBe(0);
  });
});
