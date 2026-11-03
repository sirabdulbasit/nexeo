/**
 * Admin — Screen operator (DEF-386).
 *
 * Mounted at /api/v1/admin/operator.
 *   GET  /   this tenant's settings + this month's usage (super admin: ?client_number=)
 *   PUT  /   change settings
 *
 * Who may change what:
 *   tenant ADMIN — enabled, consent (records who and when), privateMode, blankApps
 *   SUPER ADMIN  — also model, claudeModel, uitarsBaseUrl, uitarsModel, monthly limits,
 *                  maxSteps: the model and the bill are Nexeo's per-customer settings.
 * Withdrawing consent also turns the operator off.
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import prisma from '../../db/prisma';
import { getOperatorSettings, monthUsage } from '../../services/operator/operatorService';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

function tenantOf(req: Request): string {
  const asked = typeof req.query.client_number === 'string' ? req.query.client_number : (req.body?.client_number as string | undefined);
  return req.user!.isSuperAdmin && asked ? asked : req.user!.clientNumber;
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const clientNumber = tenantOf(req);
    const [settings, usage] = await Promise.all([getOperatorSettings(clientNumber), monthUsage(clientNumber)]);
    res.json({ clientNumber, settings, usage, anthropicConfigured: !!process.env.ANTHROPIC_API_KEY });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const int = (v: unknown, min: number, max: number): number | undefined => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

router.put('/', async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const clientNumber = tenantOf(req);
  const data: Record<string, unknown> = {};
  if (typeof b.enabled === 'boolean') data.enabled = b.enabled;
  if (typeof b.privateMode === 'boolean') data.privateMode = b.privateMode;
  if (Array.isArray(b.blankApps)) data.blankApps = b.blankApps.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 50);
  if (b.consent === true) { data.consentAt = new Date(); data.consentBy = req.user!.id; }
  if (b.consent === false) { data.consentAt = null; data.consentBy = null; data.enabled = false; }

  const superOnly = ['model', 'claudeModel', 'uitarsBaseUrl', 'uitarsModel', 'monthlyTaskLimit', 'monthlyStepLimit', 'maxSteps'].filter((k) => k in b);
  if (superOnly.length && !req.user!.isSuperAdmin) {
    res.status(403).json({ error: `Only a Nexeo super admin can change: ${superOnly.join(', ')}` });
    return;
  }
  if ('model' in b) { if (b.model !== 'claude' && b.model !== 'uitars') { res.status(400).json({ error: 'model must be claude or uitars' }); return; } data.model = b.model; }
  if (typeof b.claudeModel === 'string' && /^claude-[a-z0-9-]{3,50}$/.test(b.claudeModel)) data.claudeModel = b.claudeModel;
  if ('uitarsBaseUrl' in b) {
    if (b.uitarsBaseUrl !== null && !/^https?:\/\/\S{3,290}$/.test(String(b.uitarsBaseUrl))) { res.status(400).json({ error: 'uitarsBaseUrl must be an http(s) URL' }); return; }
    data.uitarsBaseUrl = b.uitarsBaseUrl;
  }
  if (typeof b.uitarsModel === 'string' && b.uitarsModel.trim()) data.uitarsModel = b.uitarsModel.trim().slice(0, 100);
  const t = int(b.monthlyTaskLimit, 0, 100000); if (t !== undefined) data.monthlyTaskLimit = t;
  const s = int(b.monthlyStepLimit, 0, 10000000); if (s !== undefined) data.monthlyStepLimit = s;
  const m = int(b.maxSteps, 1, 100); if (m !== undefined) data.maxSteps = m;

  try {
    if (data.enabled === true) {
      const cur = await getOperatorSettings(clientNumber);
      if (!cur.consentAt && !data.consentAt) { res.status(400).json({ error: 'Record consent before turning the operator on' }); return; }
    }
    data.updatedBy = req.user!.id;
    await prisma.operatorSettings.upsert({ where: { clientNumber }, create: { clientNumber, ...data } as any, update: data as any });
    res.json({ clientNumber, settings: await getOperatorSettings(clientNumber) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
