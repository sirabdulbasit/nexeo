/**
 * Admin — actual GCP cost from the billing export. Mounted at /api/v1/admin/gcp-billing.
 * Super admin only: every row names client projects, so a tenant admin must not see this.
 *   GET  /                  the overview, from the local daily summary
 *   GET  /projects/:id      one project's SKUs and days this invoice month
 *   POST /refresh           reload from BigQuery, at most once every 5 minutes
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth';
import { billingOverview, isConfigured, manualSync, projectDetail } from '../../services/gcpBilling/gcpBillingService';

const router = Router();
router.use(requireAuth);
router.use(requireSuperAdmin);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await billingOverview());
  } catch {
    res.status(500).json({ error: 'Could not read the billing summary' });
  }
});

router.get('/projects/:id', async (req: Request, res: Response) => {
  try {
    res.json(await projectDetail(String(req.params.id)));
  } catch {
    res.status(500).json({ error: 'Could not read this project' });
  }
});

router.post('/refresh', async (_req: Request, res: Response) => {
  if (!isConfigured()) { res.status(409).json({ error: 'The billing key is not set on the server' }); return; }
  try {
    const result = await manualSync();
    if ('tooSoon' in result) { res.status(429).json({ error: 'Refreshed moments ago. Try again in a few minutes' }); return; }
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
