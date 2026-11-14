/**
 * F-4 slice 2, the pack's meeting fields (agreed 13 Nov 2026 by suzi-b5; NEXEO_SUZI_AGREEMENT.md, slice-2 shapes):
 *
 *   calendar events   attendees [{name, email, self?: true}] (name from his contacts, else readable from the
 *                     address) and organizer_self per event: see dayPack.packCalendar.
 *   meetings_recorded [{meeting_id, title, start, end, outcome: record_ready | not_covered | failed,
 *                     action_items_proposed, summary?}] since the last brief. There is no record of when a brief
 *                     was delivered, so "since the last brief" is the last 24 hours: records that ended, or whose
 *                     record changed, in that window. `summary` is the first sentence of the minutes, at most 160
 *                     characters, on record_ready rows only. A meeting still transcribing is not listed.
 *
 * Only his own records. A read that fails leaves the field out of the pack, never a wrong value.
 */
import prisma from '../../db/prisma';
import { toZonedIso } from './zonedTime';
import type { PackPeople } from './dayPack';

export const RECORDED_WINDOW_MS = 24 * 3600_000;
export const SUMMARY_MAX = 160;

/** `salman.sohail@x.com` → `Salman Sohail`, the last resort when no name is known. */
export function readableName(email: string): string {
  return email.split('@')[0].split(/[._\-+]+/).map((p) => p.replace(/\d+$/, '')).filter((p) => p && !/^\d+$/.test(p))
    .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

/** His own addresses (login and integration) and his contacts' names for the given addresses. */
export async function packPeople(clientNumber: string, userId: number, emails: string[]): Promise<PackPeople> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, integrationEmail: true } as any }).catch(() => null) as any;
  const own = new Set<string>([u?.email, u?.integrationEmail].filter(Boolean).map((e: string) => e.toLowerCase()));
  const names = new Map<string, string>();
  const want = [...new Set(emails.map((e) => e.toLowerCase()).filter(Boolean))];
  if (want.length) {
    const rows = await prisma.$queryRawUnsafe<Array<{ email: string; name: string }>>(
      `SELECT DISTINCT ON (lower(f.facet_value)) lower(f.facet_value) AS email, p.display_name AS name
         FROM person_facets f JOIN persons p ON p.id = f.person_id
        WHERE p.client_number = $1 AND p.user_id = $3 AND f.facet_type = 'email' AND lower(f.facet_value) = ANY($2::text[])
          AND COALESCE(p.display_name, '') <> ''
        ORDER BY lower(f.facet_value), f.verified DESC, f.last_seen_at DESC NULLS LAST`,
      clientNumber, want, userId,
    ).catch(() => []);
    for (const r of rows) if (r.name?.trim()) names.set(r.email, r.name.trim());
  }
  return { own, names };
}

/** The first sentence of the minutes, at most 160 characters. Headings and list marks are not a sentence. */
export function firstSentence(minutes: string | null | undefined): string | null {
  const lines = String(minutes ?? '').split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim()).filter((l) => l && !/:$/.test(l));
  const t = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(/^.*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : t).trim();
  return s.length <= SUMMARY_MAX ? s : `${s.slice(0, SUMMARY_MAX - 1).trimEnd()}…`;
}

export interface RecordedMeeting {
  meeting_id: string; title: string; start: string | null; end: string | null;
  outcome: 'record_ready' | 'not_covered' | 'failed'; action_items_proposed: number; summary?: string;
}

const OUTCOMES = new Set(['record_ready', 'not_covered', 'failed']);

export async function meetingsRecorded(clientNumber: string, userId: number, now: Date, tz: string): Promise<RecordedMeeting[]> {
  const since = new Date(now.getTime() - RECORDED_WINDOW_MS);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; title: string | null; start_at: Date | null; end_at: Date | null; status: string; minutes: string | null; action_items: any }>>(
    `SELECT id, title, start_at, end_at, status, minutes, action_items FROM meeting_records
      WHERE client_number = $1 AND user_id = $2 AND status IN ('record_ready', 'not_covered', 'failed')
        AND (end_at >= $3 OR updated_at >= $3) AND COALESCE(start_at, created_at) <= $4
      ORDER BY COALESCE(end_at, start_at, created_at) DESC LIMIT 50`,
    clientNumber, userId, since, now,
  );
  return rows.filter((r) => OUTCOMES.has(r.status)).map((r) => {
    const summary = r.status === 'record_ready' ? firstSentence(r.minutes) : null;
    return {
      meeting_id: r.id, title: String(r.title || '(no title)').slice(0, 200),
      start: r.start_at ? toZonedIso(new Date(r.start_at), tz) : null, end: r.end_at ? toZonedIso(new Date(r.end_at), tz) : null,
      outcome: r.status as RecordedMeeting['outcome'],
      action_items_proposed: (Array.isArray(r.action_items) ? r.action_items : []).filter((a: any) => a?.state === 'proposed').length,
      ...(summary ? { summary } : {}),
    };
  });
}
