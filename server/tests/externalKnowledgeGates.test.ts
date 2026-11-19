/**
 * Client Owned Data (users.knowledge_model = 'external', founder 19 Nov): Nexeo runs none of its own
 * background jobs for him, and fetches and stores nothing for him (docs/Wiki-Knowledge.md §0.6).
 *
 *  (a) every job in src/jobs either asks the one guard (services/wiki/knowledgeModel) or is named in
 *      EXEMPT with its reason. A new job with neither fails here.
 *  (b) behaviour: a flagged user is skipped, an unflagged one is not, and a guard that cannot be read
 *      skips the whole cycle (never "everyone is Nexeo"). The Suzi day-pack and changes routes answer
 *      the external_knowledge body; device.report answers stored:false.
 *
 * The guard itself is real: it reads through the mocked prisma.$queryRawUnsafe below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';

const state = { external: new Set<number>(), guardDown: false };
const userFindMany = vi.fn();
const userFindUnique = vi.fn();
const otherRaw = vi.fn(async () => [] as any[]);
const ucFindUnique = vi.fn(async () => null as any);
const getAuthenticatedClient = vi.fn(async () => ({ client: null, error: 'no grant' }));
vi.mock('../src/services/integrationService', async (orig) => ({ ...(await orig<any>()), getAuthenticatedClient: (...a: any[]) => getAuthenticatedClient(...a) }));
const authed = { id: 2 };
vi.mock('../src/middleware/auth', async (orig) => ({ ...(await orig<any>()), requireAuth: (req: any, _res: any, next: any) => { req.user = { id: authed.id, clientNumber: 'TMC-0001' }; next(); } }));
vi.mock('../src/db/prisma', () => {
  const raw = async (sql: string, ...args: any[]) => {
    if (/knowledge_model <> 'nexeo'/.test(sql)) {
      if (state.guardDown) throw new Error('db down');
      return [...state.external].map((id) => ({ id }));
    }
    if (/SELECT knowledge_model FROM users/.test(sql)) {
      if (state.guardDown) throw new Error('db down');
      return [{ knowledge_model: state.external.has(Number(args[0])) ? 'external' : 'nexeo' }];
    }
    return otherRaw(sql, ...args);
  };
  const p = {
    $queryRawUnsafe: raw,
    user: { findMany: (...a: any[]) => userFindMany(...a), findUnique: (...a: any[]) => userFindUnique(...a) },
    userConnector: { findUnique: (...a: any[]) => ucFindUnique(...a), update: vi.fn(async () => ({})) },
  };
  return { __esModule: true, default: p, prisma: p };
});

const getInbox = vi.fn(async () => ({ emails: [] }));
vi.mock('../src/services/adapters/gmailAdapter', () => ({ getInbox: (...a: any[]) => getInbox(...a), readEmail: vi.fn() }));
vi.mock('../src/services/feed/feedIngestionService', () => ({ ingest: vi.fn() }));
vi.mock('../src/services/connectorSyncTracker', () => ({ stampConnectorSync: vi.fn(async () => undefined) }));

const briefHandedOver = vi.fn(async () => true);
vi.mock('../src/services/suzi/suziReach', async (orig) => ({
  ...(await orig<any>()),
  briefHandedOver: (...a: any[]) => briefHandedOver(...a),
}));
vi.mock('../src/utils/redisClient', () => ({ getRedis: () => null }));
vi.mock('../src/services/notifications/brainOutboundService', () => ({
  brainContactsUser: vi.fn(), outsideOfficeHoursFor: vi.fn(async () => false),
}));

const suziEmailRules = vi.fn(async () => [] as any[]);
vi.mock('../src/services/suzi/suziEmailRules', () => ({ suziEmailRules: (...a: any[]) => suziEmailRules(...a), ruleFor: vi.fn() }));
vi.mock('../src/services/suzi/suziSend', async (orig) => ({ ...(await orig<any>()), maySendForReal: vi.fn(async () => true) }));
vi.mock('../src/services/suzi/suziPeople', async (orig) => ({ ...(await orig<any>()), personById: vi.fn() }));
vi.mock('../src/services/suzi/suziDelegate', async (orig) => ({ ...(await orig<any>()), emailDelegate: vi.fn() }));

const buildDayPack = vi.fn(async () => ({ actions: [], emails: [], calendar: { today: [] } }));
vi.mock('../src/services/suzi/dayPack', () => ({ buildDayPack: (...a: any[]) => buildDayPack(...a) }));
const changesSince = vi.fn(async () => ({ changes: [] }));
vi.mock('../src/services/suzi/suziChanges', () => ({ changesSince: (...a: any[]) => changesSince(...a) }));
vi.mock('../src/services/userTimezoneService', () => ({ resolveUserTimezone: async () => 'UTC' }));
vi.mock('../src/services/suzi/gatewayAdminClient', () => ({ verifyGatewaySecret: async (t: any) => t === 'right-secret' }));

const saveSource = vi.fn();
vi.mock('../src/services/wiki/wikiSources', async (orig) => ({ ...(await orig<any>()), saveSource: (...a: any[]) => saveSource(...a) }));

import { pollAllActiveUsers } from '../src/jobs/gmailFeedPoller';
import { runDayBriefDispatch } from '../src/jobs/dayBriefDispatchJob';
import { runRuleForward } from '../src/jobs/ruleForwardJob';
import { runW1Op } from '../src/services/suzi/suziW1';
import { ExternalKnowledgeRefused, EXTERNAL_KNOWLEDGE } from '../src/services/wiki/knowledgeModel';
import router from '../src/routes/suziGatewayRoutes';
import connectorRouter from '../src/routes/connectorRoutes';
import { ingestEmailBody } from '../src/services/knowledge/emailBodyIngestService';

const T = 'TMC-0001';
const users = [{ id: 1, clientNumber: T, email: 'a@x.com', integrationEmail: null }, { id: 2, clientNumber: T, email: 'b@x.com', integrationEmail: null }];

beforeEach(() => {
  state.external = new Set([2]);
  state.guardDown = false;
  for (const f of [ucFindUnique, getAuthenticatedClient, userFindMany, userFindUnique, getInbox, briefHandedOver, suziEmailRules, buildDayPack, changesSince, saveSource]) f.mockClear();
  userFindMany.mockResolvedValue(users);
  userFindUnique.mockResolvedValue({ clientNumber: T, isActive: true });
});

/** Jobs that run nothing per user's knowledge, each with why. A new job must gate or be named here. */
const EXEMPT: Record<string, string> = {
  'agentActionReaper.ts': 'reaps stale/stuck agent_actions rows; these are the actions he starts through Suzi, which must keep working',
  'brainResetArchiveCleanup.ts': 'drops expired brain-reset archive tables; maintenance, fetches and sends nothing',
  'centralActionGovernor.ts': 'dispatcher only; every per-user job it runs (draft ask, action lifecycle) is gated itself',
  'centralCleanupGovernor.ts': 'dispatcher only; its per-user tasks are gated (backlog cleanup) or prune Nexeo stores',
  'delegationRecoveryJob.ts': 'marks pending delegation threads unknown/expired; state upkeep for actions he started',
  'demoExpirySuspendJob.ts': 'suspends expired demo accounts; account administration',
  'feedPublishRetry.ts': 'republishes already-stored feed rows to the bus; nothing is fetched (ingest is gated upstream)',
  'jobRunner.ts': 'the job harness itself (locks, health); runs no user work',
  'memoryDecayJob.ts': 'learning: ages what Nexeo learned about how he works, which stays in Nexeo',
  'reflectionJob.ts': 'learning: proposes inferred preferences (user_memories, a learned store) that stay in Nexeo',
  'trustPromotionJob.ts': 'learning: proposes autonomy promotion from his own approval history',
};

describe('(a) every job asks the guard or is exempt with a reason', () => {
  const dir = path.join(__dirname, '../src/jobs');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  it('the jobs directory is read', () => expect(files.length).toBeGreaterThan(20));
  for (const f of files) {
    it(f, () => {
      const src = readFileSync(path.join(dir, f), 'utf8');
      const gated = /from '\.\.\/services\/wiki\/knowledgeModel'/.test(src);
      if (!gated) expect(EXEMPT[f], `${f} neither imports services/wiki/knowledgeModel nor is in EXEMPT`).toBeTruthy();
      else expect(EXEMPT[f], `${f} is gated; drop it from EXEMPT`).toBeUndefined();
    });
  }
  it('every exempt name is a real job and carries a reason', () => {
    for (const [f, why] of Object.entries(EXEMPT)) { expect(files).toContain(f); expect(why.length).toBeGreaterThan(20); }
  });
});

describe('(b) gmailFeedPoller', () => {
  it('polls the Nexeo user, never the Client Owned Data user', async () => {
    const r = await pollAllActiveUsers();
    expect(getInbox.mock.calls.map((c) => c[0])).toEqual([1]);
    expect(r.map((x) => x.userId)).toEqual([1]);
  });
  it('guard unreadable: the whole cycle is skipped', async () => {
    state.guardDown = true;
    expect(await pollAllActiveUsers()).toEqual([]);
    expect(getInbox).not.toHaveBeenCalled();
  });
});

describe('(b) dayBriefDispatchJob', () => {
  const prefs = { brain_channel: { outboundEnabled: true, dayBriefTime: '00:00', timezone: 'UTC', suziReachOn: true } };
  beforeEach(() => userFindMany.mockResolvedValue(users.map((u) => ({ ...u, notificationPreferences: prefs }))));
  it('considers the Nexeo user only', async () => {
    const r = await runDayBriefDispatch();
    expect(r.scanned).toBe(1);
    expect(briefHandedOver.mock.calls.map((c) => c[1])).toEqual([1]);
  });
  it('guard unreadable: nothing is scanned', async () => {
    state.guardDown = true;
    const r = await runDayBriefDispatch();
    expect(r).toMatchObject({ scanned: 0, fired: 0 });
    expect(briefHandedOver).not.toHaveBeenCalled();
  });
});

describe('(b) ruleForwardJob', () => {
  it('reads rules for the Nexeo user only and counts the skip', async () => {
    const r = await runRuleForward();
    expect(suziEmailRules.mock.calls.map((c) => c[1])).toEqual([1]);
    expect(r.skipped.external_knowledge).toBe(1);
  });
  it('guard unreadable: the cycle forwards nothing and reads no rules', async () => {
    state.guardDown = true;
    const r = await runRuleForward();
    expect(r).toMatchObject({ users: 0, forwarded: 0 });
    expect(suziEmailRules).not.toHaveBeenCalled();
  });
});

describe('(b) Suzi routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/g', router);
  const get = (p: string, id: number) => request(app).get(`/g/${p}?user_id=${id}&tenant_id=${T}`).set('Authorization', 'Bearer right-secret');
  for (const p of ['day-pack', 'changes']) {
    it(`${p}: the Client Owned Data user gets the external_knowledge body (200), nothing is built`, async () => {
      const r = await get(p, 2);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ [EXTERNAL_KNOWLEDGE]: true, knowledge_model: 'external' });
      expect(buildDayPack).not.toHaveBeenCalled();
      expect(changesSince).not.toHaveBeenCalled();
    });
    it(`${p}: the Nexeo user is served as before`, async () => {
      const r = await get(p, 1);
      expect(r.status).toBe(200);
      expect(r.body[EXTERNAL_KNOWLEDGE]).toBeUndefined();
      expect(p === 'day-pack' ? buildDayPack : changesSince).toHaveBeenCalledTimes(1);
    });
    it(`${p}: guard unreadable fails closed`, async () => {
      state.guardDown = true;
      const r = await get(p, 1);
      expect(r.body[EXTERNAL_KNOWLEDGE]).toBe(true);
    });
  }
});

describe('(b) device.report', () => {
  it('the Wiki refuses: answered stored:false, not an error', async () => {
    saveSource.mockRejectedValueOnce(new ExternalKnowledgeRefused('source record'));
    const r: any = await runW1Op(T, 2, 'device.report', { settings: {}, audit: [], usage: {} }, true, { signatureVerified: true, deviceId: 'mac1' });
    expect(r).toMatchObject({ ok: true, item: { stored: false } });
  });
  it('stored as before for a Nexeo user', async () => {
    saveSource.mockResolvedValueOnce({ id: 's1' });
    const r: any = await runW1Op(T, 1, 'device.report', { settings: {}, audit: [], usage: {} }, true, { signatureVerified: true, deviceId: 'mac1' });
    expect(r).toMatchObject({ ok: true, item: { stored: true } });
  });
});

describe('(b) feed ingest: no feed row for a Client Owned Data user', () => {
  it('a flagged userId is skipped before any write; unflagged goes on', async () => {
    const real = await vi.importActual<typeof import('../src/services/feed/feedIngestionService')>('../src/services/feed/feedIngestionService');
    const input = { clientNumber: T, sourceType: 'gmail' as any, sourceId: 'm1', payload: { subject: 'hi' } };
    expect(await real.ingest({ ...input, userId: 2 })).toMatchObject({ status: 'external_knowledge' });
    const r = await real.ingest({ ...input, userId: 1 }).catch(() => ({ status: 'went_on' }));
    expect(r.status).not.toBe('external_knowledge');
    state.guardDown = true; // unreadable: fails closed
    expect(await real.ingest({ ...input, userId: 1 })).toMatchObject({ status: 'external_knowledge' });
  });
});

describe('(b) email body ingest: no Gmail fetch for a Client Owned Data user', () => {
  const p = { clientNumber: T, gmailMessageId: 'g1', feedEventId: 'f1', senderEmail: null, senderName: null, subject: null, receivedAt: new Date() };
  it('flagged: null, Gmail never asked', async () => {
    expect(await ingestEmailBody({ ...p, userId: 2 })).toBeNull();
    expect(getAuthenticatedClient).not.toHaveBeenCalled();
  });
  it('unflagged: Gmail is asked as before', async () => {
    await ingestEmailBody({ ...p, userId: 1 }).catch(() => null);
    expect(getAuthenticatedClient).toHaveBeenCalledWith(1);
  });
});

describe('(b) POST /connectors/scribe/:id', () => {
  const app = express();
  app.use(express.json());
  app.use('/c', connectorRouter);
  it('flagged: 200 external_knowledge body, the connector is not even read', async () => {
    authed.id = 2;
    const r = await request(app).post('/c/scribe/ct_gmail').send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ [EXTERNAL_KNOWLEDGE]: true });
    expect(ucFindUnique).not.toHaveBeenCalled();
  });
  it('unflagged: handled as before (404 for an unknown connector)', async () => {
    authed.id = 1;
    const r = await request(app).post('/c/scribe/ct_gmail').send({});
    expect(r.status).toBe(404);
    expect(ucFindUnique).toHaveBeenCalled();
  });
});
