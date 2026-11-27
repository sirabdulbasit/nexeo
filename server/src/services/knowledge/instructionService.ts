/**
 * Instructions — the 6th layer of MyOS.
 *
 * Standing orders the user has given Brain that Brain MUST respect across
 * every reasoning turn and every autonomous action. Different from Feed
 * (which is what happened) and different from ShadowRules (which are
 * learned from behaviour). Instructions are explicit human intent.
 *
 * Examples:
 *   "Always delegate Raazia's emails to Asad"                  (standing_rule)
 *   "Alert me immediately if anyone mentions EXIM"             (watchpoint)
 *   "Follow up with Fahim if no reply by Thursday"            (follow_up)
 *   "Send me a weekly summary every Friday 5pm"                (scheduled)
 *   "Call Kate next Wednesday"                                 (todo)
 *   "Update me when Project 846 hits UAT"                      (update_request)
 *
 * Storage: wiki_pages with pageType='instruction'. Metadata carries the
 * structured form; body is the natural-language original so Brain can
 * quote it back when citing. Linked into the graph so clicking "Raazia"
 * in her entity_person page shows any instruction that mentions her.
 *
 * Lifecycle:
 *   status=active    → respected by every composer / triage / cognitive turn
 *   status=paused    → user pressed pause, Brain reads but doesn't act
 *   status=fulfilled → one-shot done (e.g. a todo completed)
 *   status=archived  → user removed
 */
import prisma from '../../db/prisma';
import createLogger from '../../utils/logger';
import { callLLM } from '../llmRouter';
import { BRAIN_SCHEMA_VERSION } from './brainSchema';
import { type InstructionSchedule, parseSchedule, describeSchedule, withScheduleLine } from './instructionSchedule';

const log = createLogger('instruction');

export type InstructionKind =
  | 'standing_rule' | 'watchpoint' | 'follow_up'
  | 'scheduled' | 'todo' | 'update_request' | 'unknown';

export type InstructionStatus = 'active' | 'paused' | 'fulfilled' | 'archived';

/**
 * Scope of an instruction.
 *   'client' → tenant-wide. Visible to every user in the clientNumber. Only
 *              SA/AD can create or modify. Intended for compliance, brand
 *              voice, delegation policy, SLA rules.
 *   'user'   → per-user. Visible only to the author. Default for
 *              personal preferences, watchpoints, follow-ups.
 *
 * The composer renders the two blocks separately so Brain can weight
 * client rules as organizational-authoritative and user rules as
 * personal-preference.
 */
export type InstructionScope = 'client' | 'user';

export interface StructuredInstruction {
  kind: InstructionKind;
  title: string;
  originalText: string;
  /** Who / what to watch. Free-form. Example: "Raazia", "EXIM", "Project 846". */
  subject?: string | null;
  /** When to fire (ISO) OR null for standing / watchpoint. */
  dueAt?: string | null;
  /** Freeform condition — Brain interprets. "no reply by Thursday", "if urgent". */
  condition?: string | null;
  /** Action implied — "delegate to Asad", "notify me", "draft reply", "add to open items". */
  action?: string | null;
}

const PARSER_SYSTEM = `You parse natural-language commands from an executive into a STRUCTURED instruction that an AI assistant can act on. Output ONLY a JSON object with this shape:

{
  "kind": "standing_rule" | "watchpoint" | "follow_up" | "scheduled" | "todo" | "update_request" | "unknown",
  "title": "short 3-8 word label",
  "subject": "who or what is being watched (name/email/topic/id, or null)",
  "dueAt": "ISO timestamp if a specific time was named, otherwise null",
  "condition": "short condition phrase in the user's words, or null",
  "action": "the action Brain should take (delegate to X / notify me / draft reply / remind me / add open item), or null"
}

Rules:
- kind=standing_rule when it's an "always do X" rule (no deadline, no one-off)
- kind=watchpoint when it's "alert/notify/tell me IF X happens"
- kind=follow_up when it names a person/topic AND a deadline
- kind=scheduled when it's on a cron-like schedule ("every Friday", "daily at 9am")
- kind=todo when it's a one-off personal task the user wants to do themselves
- kind=update_request when it's "update me when X changes"
- Use kind=unknown if you truly can't tell
- Never invent times or subjects. If not stated, return null.

Examples:
Input: "Always delegate Raazia's emails to Asad"
Output: {"kind":"standing_rule","title":"Delegate Raazia's emails to Asad","subject":"Raazia","dueAt":null,"condition":"email from Raazia","action":"delegate to Asad"}

Input: "Remind me to call Kate next Wednesday"
Output: {"kind":"todo","title":"Call Kate","subject":"Kate","dueAt":null,"condition":"next Wednesday","action":"remind me"}

Input: "Notify me immediately if anyone mentions EXIM"
Output: {"kind":"watchpoint","title":"EXIM mentions alert","subject":"EXIM","dueAt":null,"condition":"anyone mentions EXIM","action":"notify me immediately"}`;

export async function parseInstruction(
  text: string,
  userId: number,
  clientNumber: string,
): Promise<StructuredInstruction> {
  const fallback: StructuredInstruction = {
    kind: 'unknown',
    title: text.slice(0, 60),
    originalText: text,
    subject: null, dueAt: null, condition: null, action: null,
  };
  try {
    const r = await callLLM(PARSER_SYSTEM, text, {
      maxTokens: 320,
      providers: ['gemini-flash', 'gemini', 'claude'],
      userId, clientNumber, purpose: 'instruction_parse',
    });
    const m = r.text.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const obj = JSON.parse(m[0]);
    const kind: InstructionKind =
      ['standing_rule','watchpoint','follow_up','scheduled','todo','update_request','unknown'].includes(obj.kind)
        ? obj.kind : 'unknown';
    return {
      kind,
      title: String(obj.title ?? text).slice(0, 120),
      originalText: text,
      subject: obj.subject ? String(obj.subject).slice(0, 200) : null,
      dueAt: obj.dueAt || null,
      condition: obj.condition ? String(obj.condition).slice(0, 300) : null,
      action: obj.action ? String(obj.action).slice(0, 300) : null,
    };
  } catch (err: any) {
    log.warn('parseInstruction failed', { error: err.message });
    return fallback;
  }
}

export async function createInstructionFromText(
  clientNumber: string,
  userId: number,
  text: string,
  scope: InstructionScope = 'user',
  /** Link T41 round 9: when he said when ("every Friday"); already checked by parseSchedule. */
  schedule: InstructionSchedule | null = null,
  /** T50 (both AGREE 27 Nov): where a scheduled instruction runs and whether its message may go by itself. */
  job: InstructionJob | null = null,
): Promise<{ id: string; structured: StructuredInstruction; scope: InstructionScope } | null> {
  const clean = text.trim();
  if (!clean) return null;

  const structured = await parseInstruction(clean, userId, clientNumber);

  const body = withScheduleLine([
    `# ${structured.title}`,
    '',
    `**Scope:** ${scope}`,
    `**Kind:** ${structured.kind}`,
    `**Status:** active`,
    `**Given:** ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    structured.subject ? `**Subject:** ${structured.subject}` : '',
    structured.dueAt ? `**Due:** ${structured.dueAt}` : '',
    structured.condition ? `**Condition:** ${structured.condition}` : '',
    structured.action ? `**Action:** ${structured.action}` : '',
    '',
    '## Original text',
    clean,
  ].filter(Boolean).join('\n'), schedule, job?.runs_on ?? 'mac');

  const metadata = {
    schemaVersion: BRAIN_SCHEMA_VERSION,
    scope,
    authoredBy: `user:${userId}`,
    status: 'active' as InstructionStatus,
    kind: structured.kind,
    subject: structured.subject,
    dueAt: structured.dueAt,
    condition: structured.condition,
    action: structured.action,
    originalText: clean,
    ...(schedule ? { schedule } : {}),
    ...(schedule && job ? { job } : {}),
    createdAt: new Date().toISOString(),
    lastFiredAt: null as string | null,
    fireCount: 0,
  };

  try {
    const created = await prisma.wikiPage.create({
      data: {
        clientNumber, userId,
        pageType: 'instruction', title: structured.title.slice(0, 300),
        bodyMarkdown: body, metadata: metadata as any,
        storage: 'postgres', status: 'active',
        lastUpdatedBy: 'instruction_service',
      },
    });
    void (async () => {
      try {
        const { embedWikiPage } = await import('./wikiEmbeddingService');
        await embedWikiPage(created.id);
      } catch { /* best effort */ }
    })();
    log.info('instruction created', { userId, scope, kind: structured.kind, id: created.id, title: structured.title });
    // Bust the per-user instructions cache so the composer envelope
    // sees the new rule on the next turn instead of a 30s-stale list.
    void (async () => {
      try {
        const { invalidate } = await import('../../utils/redisClient');
        if (scope === 'client') {
          // Client-scope rules are visible to every user — invalidate all.
          await invalidate(`instructions:${clientNumber}:*`);
        } else {
          await invalidate(`instructions:${clientNumber}:${userId}`);
        }
      } catch { /* best effort */ }
    })();
    // Founder, 13 Nov (Wiki-Knowledge §0.9): a rule he types works everywhere. An email rule ("always ignore Demo VM
    // alerts") also becomes the email rule Suzi's list applies, linked to this instruction (DEF-457).
    if (scope === 'user' && structured.kind === 'standing_rule') {
      try {
        const { emailRuleFromInstruction } = await import('../suzi/instructionEmailRules');
        await emailRuleFromInstruction(clientNumber, userId, created.id, clean);
      } catch { /* the instruction stands */ }
    }
    return { id: created.id, structured, scope };
  } catch (err: any) {
    log.warn('createInstruction failed', { error: err.message });
    return null;
  }
}

/**
 * T50: the job part of a scheduled instruction, kept on its Wiki page (metadata.job). `send: "auto"` only with `said`,
 * his own words for that job (Suzi's condition 3); never inferred. Run records (`runs`, newest 20) and the run claims
 * live beside these and are written only by scheduledJobs.ts.
 */
export interface InstructionJob { runs_on: 'nexeo' | 'mac'; send: 'ask' | 'auto'; said?: string }

/** The one reader of a stored or arriving job part. Anything unclear is the stricter reading: mac is kept, auto is not. */
export function parseJob(v: unknown): InstructionJob | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const j = v as Record<string, unknown>;
  if (j.runs_on !== 'nexeo' && j.runs_on !== 'mac') return null;
  const said = typeof j.said === 'string' ? j.said.trim().slice(0, 300) : '';
  return j.send === 'auto' && said ? { runs_on: j.runs_on, send: 'auto', said } : { runs_on: j.runs_on, send: 'ask' };
}

export interface ActiveInstructionRow {
  id: string;
  title: string;
  kind: InstructionKind;
  scope: InstructionScope;
  subject: string | null;
  dueAt: string | null;
  condition: string | null;
  action: string | null;
  originalText: string;
  createdAt: string;
  /** active | paused (paused only when asked for, for My Rules). */
  status?: InstructionStatus;
  /** DEF-248 — `authoredBy` (`user:<id>`) has been persisted on every rule
   *  since creation and was never selected or shown. Optional because rows
   *  written before the field existed legitimately lack it — the renderer
   *  says so rather than guessing. */
  authoredBy?: string | null;
  /** Link T41 round 9: present only on an instruction that has one. */
  schedule?: InstructionSchedule | null;
  /** T50: present only on a scheduled instruction that has a job part. */
  job?: InstructionJob | null;
}

/**
 * Active instructions visible to `userId` in `clientNumber`.
 * Returns BOTH scopes:
 *   - every client-scope instruction in the tenant
 *   - every user-scope instruction the user authored
 *
 * Client-scope rules come first so the renderer (and Brain) reads them
 * as the organizational-authoritative layer; user-scope rules follow
 * as personal preferences stacked on top.
 */
/**
 * Third review, item 2 (owner approved 13 Nov 2026, Rules.md §11): the rules could not be read. Never an empty list:
 * an empty list means "he has no rules", which let an auto-action through a veto that was only unreadable.
 */
export class RulesUnavailable extends Error {
  constructor(cause?: string) { super(`standing instructions could not be read${cause ? `: ${cause}` : ''}`); this.name = 'RulesUnavailable'; }
}

/** What Brain is told when the rules cannot be read: say so, and do nothing that needs them. */
export const RULES_UNAVAILABLE_BLOCK = [
  "STANDING INSTRUCTIONS: COULD NOT BE READ just now (a database error, not \"no rules\").",
  "Do not act on anything that depends on the user's rules. If the user asks about a rule, say the rules could not be read just now.",
].join('\n');

/** The safety ceiling of the one governed read. Every reader gets the same rules; a user past it is logged. */
export const RULES_READ_CEILING = 1000;

export async function getActiveInstructions(
  clientNumber: string,
  userId: number,
  /** My Rules only: paused rules too, so a paused rule can be resumed (Rules.md §2.4). Brain never passes it. */
  opts: { includePaused?: boolean } = {},
): Promise<ActiveInstructionRow[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, title, metadata->>'kind' AS kind,
            COALESCE(metadata->>'scope', 'user') AS scope,
            metadata->>'subject' AS subject, metadata->>'dueAt' AS "dueAt",
            metadata->>'condition' AS condition, metadata->>'action' AS action,
            metadata->>'originalText' AS "originalText",
            metadata->>'createdAt' AS "createdAt",
            metadata->>'authoredBy' AS "authoredBy",
            metadata->>'status' AS status,
            metadata->'schedule' AS schedule,
            metadata->'job' AS job
       FROM wiki_pages
      WHERE client_number = $1
        AND page_type = 'instruction'
        AND status = 'active'
        AND metadata->>'status' = ANY($4::text[])
        AND (
          COALESCE(metadata->>'scope', 'user') = 'client'
          OR user_id = $2
        )
      ORDER BY (COALESCE(metadata->>'scope', 'user') = 'client') DESC,
               (metadata->>'createdAt') DESC
      LIMIT $3`,
    clientNumber, userId, RULES_READ_CEILING, opts.includePaused ? ['active', 'paused'] : ['active'],
  ).catch((e: any) => { throw new RulesUnavailable(String(e?.message ?? e).slice(0, 120)); });
  if (rows.length >= RULES_READ_CEILING) log.warn('rules read hit its ceiling', { clientNumber, userId, ceiling: RULES_READ_CEILING });
  // A stored schedule is read through the same checker as an arriving one: an unreadable one is no schedule.
  for (const r of rows) { r.schedule = r.schedule == null ? null : parseSchedule(r.schedule); r.job = r.schedule ? parseJob(r.job) : null; }
  return rows as ActiveInstructionRow[];
}

/** Render active instructions as a markdown block Brain can drop into
 *  its compose prompt. Two subsections (client then user) so Brain can
 *  weight client compliance/brand rules as organizational-authoritative
 *  and user rules as personal preferences. Empty sections are skipped. */
export function renderInstructionsBlock(rows: ActiveInstructionRow[]): string {
  if (rows.length === 0) return '';
  const clientRules = rows.filter((r) => r.scope === 'client');
  const userRules = rows.filter((r) => r.scope !== 'client');
  const lines: string[] = [];
  lines.push('## Standing instructions (non-negotiable)');
  lines.push('These are explicit orders. Respect every one in your answer and any action you take. Client rules are organizational policy and override conflicting user preferences.');

  // DEF-248 — `Asked Brain where a rule or notification came from and was
  // given an invented source`. Asked *"from where you got those rules of
  // brain"*, Brain answered *"My operating rules come from my core
  // programming"* — and separately told him HE had chosen a notification
  // style in settings, which he had not. The model was holding a block of
  // rules with no origin stated, so it invented one; every rule's real
  // provenance (`authoredBy`, `createdAt`, and `originalText` — the author's
  // verbatim sentence) had been persisted since creation and simply never
  // shown. Same mechanism as DEF-199: rules about honesty cannot fix a join
  // that is absent from the context. So the join is performed here, and the
  // provenance answer is licensed from it — in the ONE renderer all three
  // consumers share (legacy composer, reasoning composer, voice context),
  // so no path can drift.
  lines.push('');
  lines.push('WHERE THESE RULES COME FROM — every rule below was stated by a PERSON and recorded');
  lines.push('verbatim: the quoted sentence is the author\'s own words, and the date is when it was');
  lines.push('recorded (user rules by this user; client rules by a tenant admin). None of them are');
  lines.push('"core programming", system defaults, or anything you were born with. If asked where a');
  lines.push('rule or behaviour came from, answer from THIS list: quote the rule\'s own words and its');
  lines.push('recorded date. If the behaviour he asks about is NOT in this list, say plainly that you');
  lines.push('have no recorded rule for it — never attribute it to your programming, and never tell');
  lines.push('him he chose or configured something unless a recorded rule or a settings block you can');
  lines.push('actually see says he did. A rule marked "recording date not on file" is still a real,');
  lines.push('recorded rule — only its date is missing, so quote its words and say the date was not');
  lines.push('kept.');

  const renderRow = (r: ActiveInstructionRow): string => {
    const extras: string[] = [];
    if (r.subject)   extras.push(`subject: ${r.subject}`);
    if (r.condition) extras.push(`condition: ${r.condition}`);
    if (r.action)    extras.push(`action: ${r.action}`);
    if (r.dueAt)     extras.push(`due: ${r.dueAt}`);
    if (r.schedule)  extras.push(r.job?.runs_on === 'nexeo' ? `Nexeo runs it ${describeSchedule(r.schedule, 'nexeo')}` : `runs on his computer ${describeSchedule(r.schedule)}`);
    // DEF-248 — the provenance travels WITH the rule. Date only: `authoredBy`
    // is a `user:<id>` key the model cannot pronounce, and DEF-199 proved a
    // bare key invites a borrowed name — scope (already in the section
    // heading) says who-class, the date says when. A missing date is stated,
    // never guessed.
    const recorded = r.createdAt
      ? `recorded ${String(r.createdAt).slice(0, 10)}`
      : 'recording date not on file';
    extras.push(recorded);
    return `- [${r.kind}] **${r.title}** — ${r.originalText}  (${extras.join('; ')})`;
  };

  if (clientRules.length > 0) {
    lines.push('');
    lines.push('### Client rules (tenant-wide — compliance, brand voice, delegation policy)');
    for (const r of clientRules) lines.push(renderRow(r));
  }
  if (userRules.length > 0) {
    lines.push('');
    lines.push('### User rules (personal — only this user)');
    for (const r of userRules) lines.push(renderRow(r));
  }
  return lines.join('\n');
}

export async function updateInstructionStatus(
  clientNumber: string,
  userId: number,
  id: string,
  status: InstructionStatus,
  opts: { isAdmin?: boolean } = {},
): Promise<{ ok: boolean; reason?: string }> {
  try {
    // Client-scope rules are tenant-wide; any user may own the row, but
    // only admins (SA/AD) can mutate. User-scope rules may only be
    // mutated by their author.
    const page = await prisma.wikiPage.findFirst({
      where: { id, clientNumber, pageType: 'instruction' },
      select: { id: true, metadata: true, userId: true },
    });
    if (!page) return { ok: false, reason: 'not found' };
    const meta: any = page.metadata ?? {};
    const scope: InstructionScope = meta.scope === 'client' ? 'client' : 'user';
    if (scope === 'client') {
      if (!opts.isAdmin) return { ok: false, reason: 'client-scope instructions require admin' };
    } else {
      if (page.userId !== userId) return { ok: false, reason: 'not your instruction' };
    }
    meta.status = status;
    // Third review item 1 (owner approved 13 Nov 2026): the instruction and its email rule (DEF-457) change in ONE
    // transaction: both or neither, so a failed second write can never leave the email rule on after a pause.
    // DEF-466 (13 Nov, found on the real database): the array form refused the wrapped raw statement AFTER running it,
    // so a pause failed and still flipped the email rule. One interactive transaction, every statement on tx.
    const { followInstructionStatus } = await import('../suzi/instructionEmailRules');
    await prisma.$transaction(async (tx) => {
      await tx.wikiPage.update({
        where: { id: page.id },
        data: {
          metadata: meta as any,
          status: status === 'archived' ? 'deleted' : 'active',
          lastUpdatedAt: new Date(),
          lastUpdatedBy: 'instruction_service',
        },
      });
      await followInstructionStatus(clientNumber, page.userId ?? userId, page.id, status === 'active', tx as any);
    });
    void (async () => {
      try {
        const { invalidate } = await import('../../utils/redisClient');
        await invalidate(`instructions:${clientNumber}:*`);
      } catch { /* best effort */ }
    })();
    return { ok: true };
  } catch (err: any) {
    log.warn('updateInstructionStatus failed', { id, error: err.message });
    return { ok: false, reason: err.message };
  }
}

/**
 * Link T41 round 9 (`instruction.update`): set or clear an instruction's schedule. Only the schedule: a new wording is
 * remove + add. Same gate as a status change: the author of a personal rule, an admin for a company rule.
 */
export async function setInstructionSchedule(
  clientNumber: string,
  userId: number,
  id: string,
  schedule: InstructionSchedule | null,
  opts: { isAdmin?: boolean } = {},
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const page = await prisma.wikiPage.findFirst({
      where: { id, clientNumber, pageType: 'instruction', status: 'active' },
      select: { id: true, metadata: true, userId: true, bodyMarkdown: true },
    });
    const meta: any = page?.metadata ?? {};
    if (!page || meta.status === 'archived' || meta.status === 'fulfilled') return { ok: false, reason: 'not found' };
    if (meta.scope === 'client') {
      if (!opts.isAdmin) return { ok: false, reason: 'client-scope instructions require admin' };
    } else if (page.userId !== userId) {
      return { ok: false, reason: 'not your instruction' };
    }
    if (schedule) meta.schedule = schedule; else delete meta.schedule;
    await prisma.wikiPage.update({
      where: { id: page.id },
      data: {
        metadata: meta as any,
        bodyMarkdown: withScheduleLine(page.bodyMarkdown ?? '', schedule, parseJob(meta.job)?.runs_on ?? 'mac'),
        lastUpdatedAt: new Date(),
        lastUpdatedBy: 'instruction_service',
      },
    });
    void (async () => {
      try {
        const { invalidate } = await import('../../utils/redisClient');
        await invalidate(`instructions:${clientNumber}:*`);
      } catch { /* best effort */ }
    })();
    return { ok: true };
  } catch (err: any) {
    log.warn('setInstructionSchedule failed', { id, error: err.message });
    return { ok: false, reason: err.message };
  }
}

/**
 * T50 (`instruction.update {id, runs_on | send}`): where a scheduled instruction runs, and whether its message may go
 * by itself. Same gate as the schedule: the author of a personal rule, an admin for a company rule. Only on an
 * instruction that has a schedule. `send: "auto"` needs `said`, his words; without them it is refused, never assumed.
 * The page's other job fields (runs, claims) are left exactly as they are: one jsonb_set per field, no read-modify-write.
 */
export async function setInstructionJob(
  clientNumber: string,
  userId: number,
  id: string,
  change: { runs_on?: 'nexeo' | 'mac'; send?: 'ask' | 'auto'; said?: string },
  opts: { isAdmin?: boolean } = {},
): Promise<{ ok: boolean; reason?: string; job?: InstructionJob }> {
  try {
    const page = await prisma.wikiPage.findFirst({
      where: { id, clientNumber, pageType: 'instruction', status: 'active' },
      select: { id: true, metadata: true, userId: true, bodyMarkdown: true },
    });
    const meta: any = page?.metadata ?? {};
    if (!page || meta.status === 'archived' || meta.status === 'fulfilled') return { ok: false, reason: 'not found' };
    if (meta.scope === 'client') {
      if (!opts.isAdmin) return { ok: false, reason: 'client-scope instructions require admin' };
    } else if (page.userId !== userId) {
      return { ok: false, reason: 'not your instruction' };
    }
    const schedule = parseSchedule(meta.schedule);
    if (!schedule) return { ok: false, reason: 'no schedule: only a scheduled instruction is a job' };
    const cur = parseJob(meta.job) ?? { runs_on: 'mac' as const, send: 'ask' as const };
    const said = String(change.said ?? '').trim().slice(0, 300);
    if (change.send === 'auto' && !said) return { ok: false, reason: 'send auto needs his words (said)' };
    const next: InstructionJob = {
      runs_on: change.runs_on ?? cur.runs_on,
      ...(change.send === 'auto' ? { send: 'auto' as const, said } : change.send === 'ask' ? { send: 'ask' as const } : cur.send === 'auto' ? { send: 'auto' as const, said: cur.said } : { send: 'ask' as const }),
    };
    await prisma.$executeRawUnsafe(
      `UPDATE wiki_pages SET metadata = jsonb_set(jsonb_set(jsonb_set(
                COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('job', COALESCE(metadata->'job', '{}'::jsonb)),
                '{job,runs_on}', to_jsonb($2::text)), '{job,send}', to_jsonb($3::text)), '{job,said}', COALESCE(to_jsonb($4::text), 'null'::jsonb)),
              body_markdown = $5, last_updated_at = now(), last_updated_by = 'instruction_service'
        WHERE id = $1`,
      page.id, next.runs_on, next.send, next.said ?? null, withScheduleLine(page.bodyMarkdown ?? '', schedule, next.runs_on),
    );
    void (async () => {
      try {
        const { invalidate } = await import('../../utils/redisClient');
        await invalidate(`instructions:${clientNumber}:*`);
      } catch { /* best effort */ }
    })();
    return { ok: true, job: next };
  } catch (err: any) {
    log.warn('setInstructionJob failed', { id, error: err.message });
    return { ok: false, reason: err.message };
  }
}
