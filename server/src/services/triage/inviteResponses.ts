/**
 * DEF-475 (CL-091, 13 Nov 2026): a calendar invitation he has already answered is a meeting on his calendar, not
 * something that needs him. Before, the one placement rule (placeItem) knew no invitation, so "Invitation: PMS
 * System Demo …" sat in My Attention with Draft reply / Delegate although he had accepted it.
 *
 * For each invitation email (Google's "Invitation:" / "Updated invitation:" subject), his own answer is read from his
 * calendar (one read per user, cached 10 minutes) and matched by the event title. accepted / declined / tentative:
 * placeItem files it as handled. needsAction: it stays, with "You haven't replied to this invitation yet." A calendar
 * that cannot be read changes nothing (the card stays where it was; never hidden on a guess).
 */
import type { CalendarEvent } from '../calendarService';

const INVITE = /^\s*(updated\s+invitation|invitation)(\s+with\s+note)?\s*:\s*/i;
const TTL_MS = 10 * 60_000;
const cache = new Map<number, { at: number; events: CalendarEvent[] | null }>();

/** The event title inside an invitation subject, or null when the subject is not an invitation. */
export function inviteTitle(subject: string | null | undefined): string | null {
  const s = String(subject ?? '');
  if (!INVITE.test(s)) return null;
  const t = s.replace(INVITE, '').replace(/\s+@\s+.*$/, '').trim();
  return t || null;
}

async function upcoming(userId: number): Promise<CalendarEvent[] | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.events;
  const { getEvents } = await import('../calendarService');
  const now = Date.now();
  const r = await getEvents(userId, new Date(now - 2 * 86_400_000), new Date(now + 120 * 86_400_000), 250).catch(() => null);
  const events = r && !r.error ? r.events : null;
  cache.set(userId, { at: Date.now(), events });
  return events;
}

type Invitable = { itemType: string; subject: string; inviteResponse?: string | null; conversationSummary?: string };

export async function markInviteResponses(items: Invitable[], userId: number): Promise<void> {
  const invites = items.filter((it) => it.itemType === 'email' && inviteTitle(it.subject));
  if (!invites.length) return;
  const events = await upcoming(userId);
  if (!events) return;
  for (const it of invites) {
    const title = inviteTitle(it.subject)!.toLowerCase();
    const ev = events.find((e) => String(e.title ?? '').trim().toLowerCase() === title);
    if (!ev?.selfResponse) continue;
    it.inviteResponse = ev.selfResponse;
    if (ev.selfResponse === 'needsAction' && !String(it.conversationSummary ?? '').startsWith('You haven\'t replied')) {
      it.conversationSummary = `You haven't replied to this invitation yet. ${it.conversationSummary ?? ''}`.trim();
    }
  }
}

export function _resetInviteCache(): void { cache.clear(); }
