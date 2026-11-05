/**
 * Admin — the consumption record (Costing Charter). Mounted at /api/v1/admin/consumption.
 *   GET /?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=service|user|day|month|part|client&user=<id>&format=csv
 * A tenant admin sees their own tenant; a super admin may pass client_number, or client_number=all for every client. Default: this month.
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { GROUPS, consumptionReport, reportCsv, type ConsumptionGroup } from '../../services/consumption/consumptionService';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

router.get('/', async (req: Request, res: Response) => {
  const today = new Date().toISOString().slice(0, 10);
  const from = String(req.query.from ?? `${today.slice(0, 7)}-01`);
  const to = String(req.query.to ?? today);
  const groupBy = String(req.query.groupBy ?? 'service') as ConsumptionGroup;
  if (!GROUPS.includes(groupBy)) { res.status(400).json({ error: `groupBy must be one of ${GROUPS.join(', ')}` }); return; }
  const asked = typeof req.query.client_number === 'string' ? req.query.client_number : null;
  const clientNumber = req.user!.isSuperAdmin && asked ? (asked === 'all' ? null : asked) : req.user!.clientNumber;
  const user = Number(req.query.user);
  try {
    const report = await consumptionReport(clientNumber, { from, to, groupBy, ...(Number.isInteger(user) && user > 0 ? { userId: user } : {}) });
    if (req.query.format === 'csv') {
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="consumption-${from}-${to}-${groupBy}.csv"`);
      res.send(reportCsv(report.rows));
      return;
    }
    res.json({ clientNumber, ...report });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
