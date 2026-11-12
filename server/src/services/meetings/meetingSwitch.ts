/**
 * F-4.2 (Functional Charter, agreed 12 Nov 2026): the Meeting Assistant switch, per user, off by default, turned on
 * by the user himself (portal Settings). Stored in his own preferences: users.notification_preferences.meeting_assistant
 * = {enabled, changed_at}. The earlier tenant list `feature_meeting_assistant_users` is retired and no longer read.
 *
 *   on   → the poller reads his hosted meetings; Google sign-in asks for the two Meet scopes. If his current Google
 *          grant lacks them, the answer says needs_reconnect, and Settings shows "Reconnect Google to allow Meet".
 *   off  → the poller skips him and his Workspace Events subscription is removed. His records stay; he deletes them
 *          himself if he wants (F-4.10).
 */
import { google } from 'googleapis';
import prisma from '../../db/prisma';
import createLogger from '../../utils/logger';

const log = createLogger('meeting-switch');
export const MEET_SCOPE_URLS = [
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/meetings.space.settings',
];

export async function isOn(userId: number): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPreferences: true } as any }) as any;
  return (u?.notificationPreferences as any)?.meeting_assistant?.enabled === true;
}

/** Does his Google grant hold both Meet scopes? null when he has no working Google connection. */
export async function hasMeetScopes(userId: number, deps: { scopesOf?: (userId: number) => Promise<string[] | null> } = {}): Promise<boolean | null> {
  const scopes = deps.scopesOf ? await deps.scopesOf(userId) : await grantedScopes(userId);
  if (!scopes) return null;
  return MEET_SCOPE_URLS.every((s) => scopes.includes(s));
}

async function grantedScopes(userId: number): Promise<string[] | null> {
  try {
    const { getAuthenticatedClient } = await import('../integrationService');
    const { client } = await getAuthenticatedClient(userId);
    if (!client) return null;
    const { token } = await client.getAccessToken();
    if (!token) return null;
    const info = await google.oauth2('v2').tokeninfo({ access_token: token });
    return String(info.data.scope ?? '').split(/\s+/).filter(Boolean);
  } catch (e: any) {
    log.warn('could not read Google scopes', { userId, error: e?.message?.slice(0, 120) });
    return null;
  }
}

export interface SwitchView { enabled: boolean; meet_scopes: boolean | null; needs_reconnect: boolean }

export async function view(userId: number, deps: Parameters<typeof hasMeetScopes>[1] = {}): Promise<SwitchView> {
  const enabled = await isOn(userId);
  const meet = enabled ? await hasMeetScopes(userId, deps) : null;
  return { enabled, meet_scopes: meet, needs_reconnect: enabled && meet !== true };
}

/** Turn his own switch on or off. Only his row is written. */
export async function setSwitch(
  userId: number, clientNumber: string, enabled: boolean,
  deps: Parameters<typeof hasMeetScopes>[1] & { dropSubscription?: (clientNumber: string, userId: number) => Promise<void> } = {},
): Promise<SwitchView> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPreferences: true } as any }) as any;
  const prefs = ((u?.notificationPreferences as any) || {}) as Record<string, any>;
  prefs.meeting_assistant = { enabled, changed_at: new Date().toISOString() };
  await prisma.user.update({ where: { id: userId }, data: { notificationPreferences: prefs } as any });
  if (!enabled) await (deps.dropSubscription ?? dropSubscription)(clientNumber, userId).catch(() => undefined);
  return view(userId, deps);
}

/** Off: remove his Workspace Events subscription at Google (best effort) and our row of it. */
export async function dropSubscription(clientNumber: string, userId: number): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM meet_event_subscriptions WHERE client_number = $1 AND user_id = $2`, clientNumber, userId,
  );
  if (rows.length) {
    try {
      const { getAuthenticatedClient } = await import('../integrationService');
      const { client } = await getAuthenticatedClient(userId);
      if (client) {
        const we = google.workspaceevents({ version: 'v1', auth: client });
        for (const r of rows) await we.subscriptions.delete({ name: r.name }).catch(() => undefined);
      }
    } catch { /* the row goes regardless; an orphan at Google expires by itself */ }
  }
  await prisma.$executeRawUnsafe(`DELETE FROM meet_event_subscriptions WHERE client_number = $1 AND user_id = $2`, clientNumber, userId);
}
