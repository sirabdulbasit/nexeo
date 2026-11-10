/**
 * Link T30: the installer download behind a short-lived link from the signed-in portal (see
 * services/suzi/suziInstaller.ts). Mounted before /suzi, which needs a signed-in person, because a browser
 * download carries no Bearer token: the link itself is the permission, for 10 minutes. The bytes stream from
 * Suzi Master through Suzi's server; nothing is stored here.
 */
import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import { InstallerUnavailable, installerFetch, redeemLink } from '../services/suzi/suziInstaller';

const router = Router();
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'x-installer'];

router.get('/:token', async (req: Request, res: Response) => {
  const os = redeemLink(String(req.params.token ?? ''));
  if (!os) { res.status(410).json({ error: 'This download link has expired. Open Suzi Desktop again.' }); return; }
  try {
    const r = await installerFetch(os, 'GET', typeof req.headers.range === 'string' ? req.headers.range : undefined);
    if (r.status === 404) { res.status(404).json({ error: 'Not available yet' }); return; }
    if (!r.ok || !r.body) { res.status(502).json({ error: 'Suzi Master could not send the installer right now' }); return; }
    res.status(r.status);
    for (const h of PASS) { const v = r.headers.get(h); if (v) res.setHeader(h, v); }
    const cd = r.headers.get('content-disposition');
    res.setHeader('content-disposition', cd ?? `attachment; filename="${os === 'macos' ? 'Suzi.dmg' : 'Suzi-Setup.exe'}"`);
    res.setHeader('cache-control', 'no-store');
    const body = Readable.fromWeb(r.body as any);
    body.on('error', () => res.destroy());
    req.on('close', () => body.destroy());
    body.pipe(res);
  } catch (err) {
    res.status(err instanceof InstallerUnavailable ? 503 : 500).json({ error: err instanceof InstallerUnavailable ? err.message : 'Something went wrong' });
  }
});

export default router;
