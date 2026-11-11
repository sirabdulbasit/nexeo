/**
 * Link T30 (Master_Charter.md §3 "Installers", §4A `GET /v1/installer/<os>/latest`; founder: "Nexeo will also
 * provide downloading of .dmg and .exe ... using web/portal", "downloading should be latest build comes from
 * Suzi Master"). The portal's Suzi Desktop section offers the current installer for the visitor's system.
 *
 * Nexeo stores nothing of Suzi's: the file is streamed from Suzi Master through Suzi's server (loopback admin,
 * `GET /admin/installer?os=`) straight to the browser. A browser download cannot carry the portal's Bearer
 * token, so a signed-in person first gets a short-lived link (10 minutes, any number of requests so a
 * download can resume); the link names only the system, never a user, and lives in this process's memory.
 */
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { env } from '../../config/env';

export const INSTALLER_OS = ['macos', 'windows'] as const;
export type InstallerOs = (typeof INSTALLER_OS)[number];
export const LINK_TTL_MS = 10 * 60_000;

export interface InstallerInfo { os: InstallerOs; version: string; file: string; sha256: string; size: number; made: string | null }

export class InstallerUnavailable extends Error {}

async function secret(): Promise<string> {
  const s = (await fs.readFile(env.suziGatewayAdminSecretFile, 'utf8').catch(() => '')).trim();
  if (s.length < 32) throw new InstallerUnavailable('Suzi desktop is not set up on this server');
  return s;
}

/** One call to Suzi's server for the installer. GET streams; nothing is buffered here. */
export async function installerFetch(os: InstallerOs, method: 'GET' | 'HEAD', range?: string, fetchImpl: typeof fetch = fetch, timeoutMs?: number): Promise<Response> {
  // DEF-377: a test run never reaches the live server on this box.
  if (process.env.VITEST && process.env.SUZI_GATEWAY_IN_TESTS !== '1') throw new InstallerUnavailable('the live Suzi gateway is never called from a test run');
  const headers: Record<string, string> = { Authorization: `Bearer ${await secret()}` };
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
  try {
    return await fetchImpl(`${env.suziGatewayAdminUrl}/admin/installer?os=${os}`, {
      method, headers, redirect: 'manual',
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  } catch {
    throw new InstallerUnavailable('Suzi server could not be reached');
  }
}

/** The signed description Suzi Master sends in X-Installer (base64 JSON). null = no installer yet. */
export function parseInstallerHeader(os: InstallerOs, h: string | null): InstallerInfo | null {
  if (!h) return null;
  try {
    const j = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
    if (typeof j?.version !== 'string' || typeof j?.sha256 !== 'string') return null;
    return { os, version: j.version, file: String(j.file ?? ''), sha256: j.sha256, size: Number(j.size) || 0, made: j.made ? String(j.made) : null };
  } catch {
    return null;
  }
}

/**
 * The description of the current installer. Read with a one-byte GET, never HEAD: the charter's route is GET
 * (§4A) and Suzi Master answers HEAD with 501 (seen live 2026-11-11). The one byte is thrown away.
 */
export async function installerInfo(os: InstallerOs, fetchImpl: typeof fetch = fetch): Promise<InstallerInfo | null> {
  const r = await installerFetch(os, 'GET', 'bytes=0-0', fetchImpl, env.suziGatewayTimeoutMs);
  await r.body?.cancel().catch(() => undefined);
  if (r.status === 404) return null;
  if (r.status === 503) throw new InstallerUnavailable('Suzi Master cannot be reached right now');
  if (!r.ok) throw new InstallerUnavailable('Suzi server returned an error');
  return parseInstallerHeader(os, r.headers.get('x-installer'));
}

const links = new Map<string, { os: InstallerOs; exp: number }>();

export function issueLink(os: InstallerOs, now = Date.now()): { token: string; expiresAt: string } {
  for (const [k, v] of links) if (v.exp <= now) links.delete(k);
  const token = randomBytes(24).toString('base64url');
  links.set(token, { os, exp: now + LINK_TTL_MS });
  return { token, expiresAt: new Date(now + LINK_TTL_MS).toISOString() };
}

export function redeemLink(token: string, now = Date.now()): InstallerOs | null {
  const l = links.get(token);
  if (!l) return null;
  if (l.exp <= now) { links.delete(token); return null; }
  return l.os;
}
