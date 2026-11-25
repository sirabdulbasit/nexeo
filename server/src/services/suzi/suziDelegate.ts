/**
 * F-2 (Functional Charter, agreed 11 Nov 2026): Suzi acts on every item of the brief. Nexeo's part, the writes:
 *
 *   task.create          {title, due?, person_id?, note?, source?}: a new task of his own. With a person, it is
 *                        assigned AND the person is told (T21: delegating means telling).
 *   task.update forward  {id, person_id, note?}: reassigned AND the person told. "assign" stays silent.
 *   email.delegate       {email_id | thread_id, person_id, note?}: the email forwarded to the person with his note.
 *                        The task assigned to them is made only once the forward has really gone (afterSuziSent).
 *
 * Telling is an email from his own mailbox, so it goes through the one send gate there is (T22, suziEmail):
 * his confirmation always; really sent only when signed, voiced and on the send switch, then held 10 seconds
 * with undo. Otherwise it waits in his Gmail Drafts and nobody has been told: the answer says `told: false`.
 * The wording of a note to a person is the model's (facts given, never a canned sentence).
 */
import prisma from '../../db/prisma';
import { personById } from './suziPeople';
import { applyFollowUp } from './suziActions';
import { createHash } from 'crypto';
import { forwardEmail, latestMail, saveNewDraft, saveToGmailDrafts, writeWithModel, type SendGate } from './suziEmail';

type Args = Record<string, unknown>;
type Result = { ok: true; item: unknown } | { ok: false; error: string; detail?: string };
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const fail = (error: string, detail?: string): Result => ({ ok: false, error, ...(detail ? { detail } : {}) });
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function ownerName(clientNumber: string, userId: number): Promise<string> {
  const { getBrainPersona } = await import('../knowledge/brainPersonaService');
  const p = await getBrainPersona(userId, clientNumber).catch(() => null);
  return p?.userFullName || p?.userFirstName || 'your manager';
}

/** Who is on a task, for the note (founder 18 Nov 14:35: the person is told the lead, the others and the date). */
export type Role = 'owner' | 'helper' | 'followup';
export interface TellTask { itemId: string; title: string; due: string | null; note: string; person: { name: string; email: string }; role?: Role; lead?: string | null; helpers?: string[] }

/** The facts the model words the note from (never a canned sentence). Exported for the test. */
export function tellPrompt(owner: string, t: TellTask): string {
  const role = t.role ?? 'owner';
  const lead = role === 'owner' ? t.person.name : (t.lead || owner);
  const others = (t.helpers ?? []).filter((n) => n && n !== t.person.name);
  const ask = role === 'owner' ? `handing them this task. They are the lead owner.`
    : role === 'helper' ? `asking them to help on this task as one of the people responsible.`
    : `following up on this task, which they are responsible for. Ask where it stands.`;
  return `Write a short email from ${owner} to ${t.person.name}, ${ask}\nTask: ${t.title}\n` +
    `Lead owner: ${lead === t.person.name ? `${t.person.name} (the person this email is to)` : lead}\n` +
    `${others.length ? `Also responsible: ${others.join(', ')}\n` : ''}` +
    `Due: ${t.due ?? 'no date set yet'}\n` +
    `${t.note ? `What ${owner} wants said: ${t.note}\n` : ''}` +
    (role === 'owner' ? 'Say plainly that the task is now theirs. ' : '') +
    'Name the lead owner, everyone else responsible and the due date. Add nothing that is not given here.';
}

/** The note to the person: an email from his mailbox, through the send gate. */
async function tell(
  clientNumber: string, userId: number, gate: SendGate, t: TellTask,
): Promise<{ told: boolean; draft_id?: string; undo_until?: string; error?: string }> {
  const owner = await ownerName(clientNumber, userId);
  const body = await writeWithModel(clientNumber, userId, tellPrompt(owner, t));
  const role = t.role ?? 'owner';
  const subject = role === 'followup' ? `Following up: ${t.title}` : `Task: ${t.title}`;
  // Only the owner's note marks the delegate as told (delegation_emailed_at); a helper's or a follow-up only links
  // its thread to the task (T33 P4).
  const link = role === 'owner' ? { tellOpenItemId: t.itemId } : { tellTaskThreadOf: t.itemId, tellRole: role, tellEmail: t.person.email };
  const draft = await saveNewDraft(clientNumber, userId, { to: t.person.email, subject: subject.slice(0, 200), body, mode: 'new' }, link);
  if (!draft.ok) return { told: false, error: draft.error };
  const draftId = (draft.item as any).draft_id;
  const sent = await saveToGmailDrafts(clientNumber, userId, { draft_id: draftId }, true, gate);
  if (!sent.ok) return { told: false, draft_id: draftId, error: sent.error };
  const i: any = sent.item;
  return i.sent ? { told: true, draft_id: draftId, undo_until: i.undo_until } : { told: false, draft_id: draftId };
}

type ToldState = { state: 'sent' | 'drafted' | 'failed'; draft_id?: string; error?: string };
const toldState = (t: { told: boolean; draft_id?: string; error?: string }): ToldState =>
  t.told ? { state: 'sent', draft_id: t.draft_id } : t.draft_id && !t.error ? { state: 'drafted', draft_id: t.draft_id } : { state: 'failed', ...(t.draft_id ? { draft_id: t.draft_id } : {}), error: String(t.error ?? 'not saved').slice(0, 200) };

/** Lead (delegate or him) and helper names of a task, for the note. */
async function crew(clientNumber: string, userId: number, id: string): Promise<{ lead: string | null; helpers: string[]; title: string; due: string | null; status: string; delegateeEmail: string | null; delegateeName: string | null; metadata: unknown } | null> {
  const r = await prisma.openItem.findFirst({ where: { id, clientNumber, userId }, select: { title: true, dueDate: true, status: true, delegateeName: true, delegateeEmail: true, metadata: true } as any }) as any;
  if (!r) return null;
  const { helpersOf } = await import('./suziTaskTrail');
  return { lead: r.delegateeName || null, helpers: helpersOf(r.metadata).map((h) => h.name), title: String(r.title ?? ''), due: r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : null, status: String(r.status ?? '').toUpperCase(), delegateeEmail: r.delegateeEmail ?? null, delegateeName: r.delegateeName ?? null, metadata: r.metadata };
}

async function forwardTask(clientNumber: string, userId: number, id: string, a: Args, gate: SendGate, timezone?: string): Promise<Result> {
  const person = await personById(clientNumber, userId, text(a.person_id));
  if (!person) return fail('not_found', 'no such person');
  if (!person.email) return fail('no_email', 'telling the person needs their email on record');
  // DEF-507 (b): the same task to the same person again within 10 minutes is the first forward, not a new one (Suzi
  // retried after her 15 s limit while the first was still writing the note): no second trail entry, no second note.
  const repeat = await repeatForward(clientNumber, userId, id, person.email);
  if (repeat) {
    const { actionById } = await import('./suziActions');
    const action = await actionById(clientNumber, userId, id, timezone);
    if (action) return { ok: true, item: { ...action, assigned: true, told: repeat.told, ...(repeat.told_draft_id ? { told_draft_id: repeat.told_draft_id } : {}), repeat: true } };
  }
  const r = await applyFollowUp(clientNumber, userId, { actionId: id, update: 'assign', personId: person.id, note: text(a.note) || undefined, timezone });
  if (!r.ok) return fail(r.error, r.detail);
  // T35 (a) (both AGREE 17 Nov): the answer goes as soon as the task is assigned; the note (written by the model, which
  // can be slow) follows, and the task's told says how it ended.
  await setTold(id, { state: 'pending' });
  const c = await crew(clientNumber, userId, id).catch(() => null);
  void tell(clientNumber, userId, gate, { itemId: id, title: r.action.title, due: r.action.due, note: text(a.note), person: { name: person.name, email: person.email }, role: 'owner', helpers: c?.helpers ?? [] })
    .then((t) => setTold(id, toldState(t)))
    .catch((e: any) => setTold(id, { state: 'failed', error: String(e?.message ?? e).slice(0, 200) }));
  return { ok: true, item: { ...r.action, assigned: true, told: 'pending' } };
}

/** T35 (a): the note's outcome on the task (metadata.suziTold), merged, never a whole-row write. */
export async function setTold(itemId: string, t: { state: 'pending' | 'sent' | 'drafted' | 'failed'; draft_id?: string; error?: string }): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE open_items SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('suziTold', $2::jsonb) WHERE id = $1`,
      itemId, JSON.stringify({ ...t, at: new Date().toISOString() }),
    );
  } catch { /* the task is assigned either way; told stays as it was */ }
}

export const REPEAT_FORWARD_MS = 10 * 60_000;
/** DEF-507 (b): was this task handed to this person by Suzi in the last 10 minutes? Then the first note's state. */
export async function repeatForward(clientNumber: string, userId: number, id: string, email: string, now = new Date()): Promise<{ told: 'pending' | 'sent' | 'drafted'; told_draft_id?: string } | null> {
  const item = await prisma.openItem.findFirst({ where: { id, clientNumber, userId }, select: { delegationTrail: true } as any }) as any;
  const trail: any[] = Array.isArray(item?.delegationTrail) ? item.delegationTrail : [];
  const last = trail[trail.length - 1];
  const at = Date.parse(String(last?.delegatedAt ?? ''));
  if (!last || String(last.delegatedToEmail ?? '').toLowerCase() !== email.toLowerCase() || !Number.isFinite(at) || now.getTime() - at > REPEAT_FORWARD_MS) return null;
  const notes = await prisma.$queryRawUnsafe<Array<{ id: number; st: string | null; gd: string | null }>>(
    `SELECT id, output->'send'->>'state' AS st, output->>'gmailDraftId' AS gd FROM agent_actions
      WHERE client_number = $1 AND user_id = $2 AND action_type = 'draft_reply' AND input->>'tellOpenItemId' = $3
        AND lower(output->>'to') = lower($4) AND created_at > $5 ORDER BY id ASC LIMIT 1`,
    clientNumber, userId, id, email, new Date(now.getTime() - REPEAT_FORWARD_MS),
  ).catch(() => [] as Array<{ id: number; st: string | null; gd: string | null }>);
  const n = notes[0];
  if (!n) return { told: 'pending' }; // the first is still writing its note (T35 (a) wording)
  const sent = ['held', 'sending', 'sent'].includes(String(n.st ?? ''));
  return sent ? { told: 'sent' } : { told: 'drafted', told_draft_id: String(n.id) };
}

/** F-2.2: task.update {update: "forward"}. Confirmation is needed because someone is told. */
export async function taskForward(clientNumber: string, userId: number, a: Args, confirmed: boolean, gate: SendGate, timezone?: string): Promise<Result> {
  if (!confirmed) return fail('needs_confirmation');
  return forwardTask(clientNumber, userId, text(a.id), a, gate, timezone);
}

const OPEN_STATES = ['NEW', 'TRIAGED', 'IN_PROGRESS', 'WAITING_INFO', 'DELEGATED', 'SNOOZED'];

/**
 * T33 P2 (both AGREE 17 Nov): task.update {id, update: helper_add | helper_remove, person_id, note?}. A helper is one
 * of the people responsible; the lead owner stays one (founder 18 Nov 14:39). helper_add tells the helper (same gate
 * as forward), answering at once with told "pending" (T35 (a)); the same helper again within 10 minutes is the first
 * add (T35 (b)). Each add and remove is a dated history entry.
 */
export async function taskHelper(clientNumber: string, userId: number, a: Args, confirmed: boolean, gate: SendGate, timezone?: string, opts: { leadName?: string } = {}): Promise<Result> {
  const id = text(a.id);
  const update = text(a.update);
  const { helpersOf, setHelpers, setHelperTold, trailPush } = await import('./suziTaskTrail');
  const c = await crew(clientNumber, userId, id);
  if (!c) return fail('not_found');
  if (!OPEN_STATES.includes(c.status)) return fail('bad_state', 'it is finished or cancelled; reopen it first');
  const helpers = helpersOf(c.metadata);
  const answer = async (extra: Record<string, unknown>): Promise<Result> => {
    const { actionById } = await import('./suziActions');
    const action = await actionById(clientNumber, userId, id, timezone);
    return action ? { ok: true, item: { ...action, ...extra } } : fail('not_found');
  };
  if (update === 'helper_remove') {
    const pid = text(a.person_id);
    const h = helpers.find((x) => x.person_id === pid);
    if (!h) return fail('not_found', 'that person is not a helper on this task');
    await setHelpers(id, helpers.filter((x) => x.person_id !== pid));
    await trailPush(id, { who: 'you, through Suzi', change: `Helper removed: ${h.name}`.slice(0, 160) });
    return answer({ helper_removed: true });
  }
  if (!confirmed) return fail('needs_confirmation');
  const person = await personById(clientNumber, userId, text(a.person_id));
  if (!person) return fail('not_found', 'no such person');
  if (!person.email) return fail('no_email', 'telling a helper needs their email on record');
  if (c.delegateeEmail && c.delegateeEmail.toLowerCase() === person.email.toLowerCase()) return fail('bad_state', `${person.name} is already the lead owner of this task`);
  const had = helpers.find((x) => x.person_id === person.id);
  if (had) {
    // T35 (b): a repeat is the first add (no second entry, no second note).
    return answer({ helper_added: true, told: had.told ?? 'pending', ...(had.told === 'drafted' && had.draft_id ? { told_draft_id: had.draft_id } : {}), repeat: true });
  }
  const note = text(a.note).slice(0, 300);
  await setHelpers(id, [...helpers, { person_id: person.id, name: person.name, email: person.email, ...(note ? { note } : {}), added_at: new Date().toISOString(), told: 'pending' }]);
  await trailPush(id, { who: 'you, through Suzi', change: `Helper added: ${person.name}`.slice(0, 160), ...(note ? { note } : {}) });
  void tell(clientNumber, userId, gate, { itemId: id, title: c.title, due: c.due, note, person: { name: person.name, email: person.email }, role: 'helper', lead: opts.leadName ?? c.lead, helpers: [...c.helpers, person.name] })
    .then((t) => setHelperTold(id, person.id, toldState(t)))
    .catch(() => setHelperTold(id, person.id, { state: 'failed' }));
  return answer({ helper_added: true, told: 'pending' });
}

export const REPEAT_FOLLOWUP_MS = 10 * 60_000;

/**
 * T33 P3 (both AGREE 17 Nov): task.followup {id, person_id?, note?, all?}. To person_id; without it, to the person the
 * task is delegated to; with all: true, to the lead owner and every helper (founder 18 Nov 14:39). Each note goes
 * through the same gate as forward, answered at once (told "pending"); the same person again within 10 minutes is
 * the first follow-up. One history entry "Followed up: <name>" per person.
 */
export async function taskFollowup(clientNumber: string, userId: number, a: Args, confirmed: boolean, gate: SendGate, timezone?: string): Promise<Result> {
  if (!confirmed) return fail('needs_confirmation');
  const id = text(a.id);
  const { helpersOf, setHelperTold, trailOf, trailPush } = await import('./suziTaskTrail');
  const c = await crew(clientNumber, userId, id);
  if (!c) return fail('not_found');
  if (!OPEN_STATES.includes(c.status)) return fail('bad_state', 'it is finished or cancelled; reopen it first');
  const helpers = helpersOf(c.metadata);
  type To = { person_id: string | null; name: string; email: string; helper: boolean };
  const to: To[] = [];
  if (text(a.person_id)) {
    const p = await personById(clientNumber, userId, text(a.person_id));
    if (!p) return fail('not_found', 'no such person');
    if (!p.email) return fail('no_email', 'a follow-up needs the person\'s email on record');
    to.push({ person_id: p.id, name: p.name, email: p.email, helper: helpers.some((h) => h.person_id === p.id) });
  } else {
    if (c.delegateeEmail) to.push({ person_id: null, name: c.delegateeName || c.delegateeEmail, email: c.delegateeEmail, helper: false });
    if (a.all === true) for (const h of helpers) to.push({ person_id: h.person_id, name: h.name, email: h.email, helper: true });
    if (!to.length) return fail('bad_state', helpers.length ? 'it is not delegated; give person_id, or all: true for the helpers' : 'it is not delegated to anyone; give person_id');
  }
  // Suzi 24 Nov 12:17: when the note can't go, say so at once with the reason, never a silent "pending".
  const { sendBlockReason } = await import('./suziSend');
  const blocked = await sendBlockReason(clientNumber, userId, gate);
  if (blocked) {
    const { actionById } = await import('./suziActions');
    const action = await actionById(clientNumber, userId, id, timezone);
    const failed = to.map((t) => ({ name: t.name, ...(t.person_id ? { person_id: t.person_id } : {}), told: 'failed', reason: blocked }));
    return action ? { ok: true, item: { ...action, told: 'failed', reason: blocked, followed_up: failed } } : fail('not_found');
  }
  const note = text(a.note).slice(0, 300);
  const now = Date.now();
  const recent = trailOf(c.metadata).filter((e) => /^Followed up: /.test(e.change) && now - Date.parse(e.at) < REPEAT_FOLLOWUP_MS);
  const out: Array<{ name: string; person_id?: string; told: string; repeat?: true }> = [];
  for (const t of to) {
    const entry = `Followed up: ${t.name}`.slice(0, 160);
    if (recent.some((e) => e.change === entry)) { out.push({ name: t.name, ...(t.person_id ? { person_id: t.person_id } : {}), told: 'pending', repeat: true }); continue; }
    await trailPush(id, { who: 'you, through Suzi', change: entry, ...(note ? { note } : {}) });
    const done = (st: ToldState) => (t.helper && t.person_id ? setHelperTold(id, t.person_id, st) : setTold(id, st));
    if (!t.helper) await setTold(id, { state: 'pending' });
    void tell(clientNumber, userId, gate, { itemId: id, title: c.title, due: c.due, note, person: { name: t.name, email: t.email }, role: 'followup', lead: c.lead, helpers: c.helpers })
      .then((r) => done(toldState(r)))
      .catch(() => done({ state: 'failed' }));
    out.push({ name: t.name, ...(t.person_id ? { person_id: t.person_id } : {}), told: 'pending' });
  }
  const { actionById } = await import('./suziActions');
  const action = await actionById(clientNumber, userId, id, timezone);
  return action ? { ok: true, item: { ...action, followed_up: out } } : fail('not_found');
}

/** task.create helpers: [person_id] or [{person_id, note?}], at most 10. */
function helpersArg(v: unknown): Array<{ person_id: string; note?: string }> {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 10).map((h) => (typeof h === 'string' ? { person_id: h.trim() } : { person_id: text((h as any)?.person_id), note: text((h as any)?.note) || undefined }))
    .filter((h) => h.person_id);
}

/** F-2.1 */
export async function taskCreate(clientNumber: string, userId: number, a: Args, confirmed: boolean, gate: SendGate, timezone?: string): Promise<Result> {
  const title = text(a.title).slice(0, 200);
  if (!title) return fail('bad_title');
  const due = text(a.due);
  if (due && (!DAY.test(due) || isNaN(Date.parse(`${due}T12:00:00Z`)))) return fail('bad_date');
  const personId = text(a.person_id);
  if (helpersArg(a.helpers).length && !confirmed) return fail('needs_confirmation');
  if (personId) {
    if (!confirmed) return fail('needs_confirmation');
    const p = await personById(clientNumber, userId, personId);
    if (!p) return fail('not_found', 'no such person');
    if (!p.email) return fail('no_email', 'telling the person needs their email on record');
  }
  const src: any = a.source && typeof a.source === 'object' ? a.source : {};
  // F-4.7: a meeting's action item (item_id) is marked accepted with the task once it is made.
  const source = text(src.email_id) ? { email_id: text(src.email_id) } : text(src.meeting_id) ? { meeting_id: text(src.meeting_id), ...(text(src.item_id) ? { item_id: text(src.item_id) } : {}) } : null;
  const note = text(a.note).slice(0, 2000);
  const { createItem } = await import('../openItemsService');
  const item = await createItem(userId, clientNumber, {
    title, type: 'task', priority: 'medium',
    ...(due ? { dueDate: new Date(`${due}T12:00:00Z`) } : {}),
    ...(note ? { description: note } : {}),
    sourceFeed: 'suzi',
    metadata: { manualCreate: true, createdBy: 'suzi', ...(source ? { suziSource: source } : {}) },
  } as any);
  if (!item?.id) return fail('rejected', 'the task was not created');
  let itemState: string | null = null;
  if (source && 'item_id' in source && source.item_id) {
    const { setActionItemState } = await import('../meetings/meetingRecordStore');
    itemState = (await setActionItemState(clientNumber, userId, source.meeting_id, source.item_id, 'accepted', item.id).catch(() => null)) ?? 'not_found';
  }
  const withItem = (r: Result): Result => (itemState && r.ok ? { ok: true, item: { ...(r.item as any), item_state: itemState } } : r);
  // T33 P2 + founder 18 Nov 14:39: one call makes a complete task: lead owner (person_id) and helpers together. Helpers
  // are added first so the lead's note names them.
  const helperArgs = helpersArg(a.helpers);
  const added: Array<{ person_id: string; ok: boolean; error?: string }> = [];
  const leadName = personId ? (await personById(clientNumber, userId, personId))?.name : undefined;
  for (const h of helperArgs) {
    const hr = await taskHelper(clientNumber, userId, { id: item.id, update: 'helper_add', person_id: h.person_id, note: h.note }, confirmed, gate, timezone, { leadName });
    added.push(hr.ok ? { person_id: h.person_id, ok: true } : { person_id: h.person_id, ok: false, error: hr.error });
  }
  const withHelpers = async (r: Result): Promise<Result> => {
    if (!helperArgs.length || !r.ok) return r;
    const { actionById } = await import('./suziActions');
    const fresh = await actionById(clientNumber, userId, item.id, timezone);
    return { ok: true, item: { ...(r.item as any), ...(fresh?.helpers ? { helpers: fresh.helpers } : {}), helpers_added: added } };
  };
  if (personId) return withItem(await withHelpers(await forwardTask(clientNumber, userId, item.id, { person_id: personId, note }, gate, timezone)));
  const r = await applyFollowUp(clientNumber, userId, { actionId: item.id, update: 'note', note: note || 'Created through Suzi', timezone });
  return withItem(await withHelpers(r.ok ? { ok: true, item: r.action } : { ok: true, item: { id: item.id, title } }));
}

/** F-2.4 proof (a): the claim key for one rule forward of one message to one person. */
export function ruleForwardKey(clientNumber: string, userId: number, messageId: string, personEmail: string): string {
  const h = createHash('sha256').update(`${clientNumber}|${userId}|${messageId}|${String(personEmail).toLowerCase()}`).digest('hex');
  return `rule_fwd:${h.slice(0, 64)}`;
}

/** F-2.3: the forward goes through the send gate; the task comes only after it has gone. */
export async function emailDelegate(clientNumber: string, userId: number, a: Args, confirmed: boolean, gate: SendGate): Promise<Result> {
  if (!confirmed) return fail('needs_confirmation');
  const threadId = text(a.email_id) || text(a.thread_id);
  const mail = await latestMail(clientNumber, userId, threadId);
  if (!mail) return fail('not_found');
  // F-2.4: the "ready" batch sends {email_id} alone; the person comes from the rule that made it ready.
  let personId = text(a.person_id);
  let ruleId = text(a.rule_id);
  if (!personId) {
    const { suziEmailRules, ruleFor } = await import('./suziEmailRules');
    const r = ruleFor((await suziEmailRules(clientNumber, userId)).filter((x) => x.kind === 'email_delegate'), { from: mail.senderEmail, subject: mail.subject });
    if (!r?.person_id) return fail('rule_removed', 'no delegate rule matches this email any more');
    personId = r.person_id;
    ruleId = r.id;
  }
  const person = await personById(clientNumber, userId, personId);
  if (!person) return fail('not_found', 'no such person');
  if (!person.email) return fail('no_email', 'delegating needs the person\'s email on record');
  const fwd = await forwardEmail(clientNumber, userId, { thread_id: threadId, to: person.email, text: text(a.note) });
  if (!fwd.ok) return fwd;
  const draftId = (fwd.item as any).draft_id;
  const row = await prisma.agentAction.findFirst({ where: { id: parseInt(draftId, 10), clientNumber, userId } as any });
  if (row) {
    const delegate = { thread_id: threadId, person_id: person.id, person_name: person.name, person_email: person.email, note: text(a.note), subject: mail.subject, rule_id: ruleId || null, ...(text(a.message_id) ? { message_id: text(a.message_id), by_rule: true } : {}) };
    await prisma.agentAction.update({ where: { id: row.id }, data: { input: { ...(row.input as any), delegate } as any } as any });
    // F-2.4 proof (a): one forward per message per person, claimed in the database before anything reaches Gmail.
    // agent_actions.idempotency_key is unique, so of two ticks (or a tick after a restart) racing on the same
    // message only one claims it; the other cancels its own draft row and stops. A change of the person makes a
    // new key, which is how a forward cancelled for a person change is queued again (proof b).
    if (gate.byRule && delegate.message_id) {
      const key = ruleForwardKey(clientNumber, userId, delegate.message_id, person.email);
      const claimed = await prisma.$executeRawUnsafe(
        `UPDATE agent_actions SET idempotency_key = $2 WHERE id = $1 AND idempotency_key IS NULL
           AND NOT EXISTS (SELECT 1 FROM agent_actions WHERE idempotency_key = $2)`, row.id, key, // the unique key still decides a photo finish
      ).then((n) => n === 1).catch(() => false);
      if (!claimed) {
        await prisma.$executeRawUnsafe(
          `UPDATE agent_actions SET output = jsonb_set(COALESCE(output, '{}'::jsonb), '{send}', COALESCE(output->'send', '{}'::jsonb) || $2::jsonb), updated_at = now() WHERE id = $1`,
          row.id, JSON.stringify({ state: 'cancelled', error: 'already_forwarded' }),
        ).catch(() => undefined);
        return fail('already_forwarded', 'this message is already being forwarded to this person');
      }
    }
  } else if (gate.byRule) {
    return fail('not_found', 'the forward could not be recorded'); // no row = no claim = nothing sent (fail closed)
  }
  const sent = await saveToGmailDrafts(clientNumber, userId, { draft_id: draftId }, true, gate);
  if (!sent.ok) return sent;
  const i: any = sent.item;
  return {
    ok: true,
    item: i.sent
      ? { state: 'held', draft_id: draftId, undo_until: i.undo_until, person_name: person.name, attachments_left_out: (fwd.item as any).attachments_left_out }
      : { state: 'saved', draft_id: draftId, held: true, ...(i.reason ? { reason: i.reason } : {}), saved_to_gmail_drafts: false, sent: false, person_name: person.name }, // founder 23 Nov: held, not in Drafts
  };
}

/**
 * Called by suziSend once a held email has really gone. A note to a person marks the task as told; a delegated
 * email gets its task now, assigned and marked told, and the task id is kept with the send for Suzi to read.
 */
export async function afterSuziSent(draftId: number, messageId: string | null): Promise<void> {
  const row = await prisma.agentAction.findFirst({ where: { id: draftId } as any });
  if (!row) return;
  const inp: any = row.input ?? {};
  const told = { delegationEmailedAt: new Date(), delegationEmailMessageId: messageId } as any;
  // T33 P4: the thread of every task email that went (forward, helper, follow-up) is linked to the task.
  const link = async (itemId: string) => {
    if (!messageId) return;
    const { threadOfMessage } = await import('../gmailService');
    const { linkThread } = await import('./suziTaskTrail');
    await linkThread(itemId, await threadOfMessage(row.userId as any, messageId), new Date()).catch(() => undefined);
  };
  if (inp.tellOpenItemId) {
    await prisma.openItem.updateMany({ where: { id: String(inp.tellOpenItemId), clientNumber: row.clientNumber, userId: row.userId as any }, data: told });
    await link(String(inp.tellOpenItemId)).catch(() => undefined);
    return;
  }
  if (inp.tellTaskThreadOf) {
    const mine = await prisma.openItem.findFirst({ where: { id: String(inp.tellTaskThreadOf), clientNumber: row.clientNumber, userId: row.userId as any }, select: { id: true } });
    if (mine) await link(mine.id).catch(() => undefined);
    return;
  }
  const d = inp.delegate;
  if (!d?.person_id) return;
  const { createItem, delegateItem, changeStatus } = await import('../openItemsService');
  const item = await createItem(row.userId as any, row.clientNumber, {
    title: `${d.subject || 'Email'}`.slice(0, 200), type: 'task', priority: 'medium', sourceFeed: 'suzi',
    ...(d.note ? { description: String(d.note).slice(0, 2000) } : {}),
    // DEF-490: the source email is linked (sourceRef: the Wiki and actions[].source find the message), and
    // the task is his to WATCH, not his to do (metadata.watch: the Wiki reads it as the person's commitment).
    sourceRef: String(d.message_id || d.thread_id),
    metadata: { manualCreate: true, createdBy: 'suzi', suziSource: { email_id: d.thread_id, ...(d.message_id ? { message_id: d.message_id } : {}) }, ...(d.rule_id ? { suziRule: d.rule_id } : {}), watch: watchOf(d) },
  } as any);
  if (!item?.id) return;
  // An existing task for the same email is the one handed over: it is watched from now on, and keeps its own history.
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE open_items SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('watch', $2::jsonb) WHERE id = $1`,
      item.id, JSON.stringify(watchOf(d)),
    );
  } catch { /* the task stands without the watch; the next delegate of this email sets it */ }
  const actor = `user:${row.userId}`;
  if (String(item.status ?? '').toUpperCase() === 'NEW') await changeStatus(item.id, row.clientNumber, 'TRIAGED' as any, `Delegating to ${d.person_name}`, actor);
  await delegateItem(item.id, row.clientNumber, null, d.person_name, d.person_email, d.note || 'Delegated through Suzi', actor);
  await prisma.openItem.update({ where: { id: item.id }, data: told });
  await link(item.id).catch(() => undefined);
  await prisma.$executeRawUnsafe(
    `UPDATE agent_actions SET output = jsonb_set(output, '{send}', (output->'send') || $2::jsonb), updated_at = now() WHERE id = $1`,
    draftId, JSON.stringify({ task_id: item.id }),
  );
  // It is his no longer: the thread leaves the emails needing a reply. DEF-489: learned as DELEGATED to the person, not
  // as a reply (the "handled" mark wrote decision approved, which the miner and the suggester count as draft_reply).
  const { markThread } = await import('./suziEmail');
  await markThread(row.clientNumber, row.userId as any, d.thread_id, 'delegated', d.by_rule ? { ruleId: d.rule_id || 'unknown' } : {}).catch(() => undefined);
}

/** DEF-490: who has it now, for the watch (brainOwnership.isWatchOnly: a person is enough). */
export function watchOf(d: { person_name?: string; person_email?: string; rule_id?: string | null; by_rule?: boolean }): Record<string, string> {
  return {
    person: String(d.person_name || d.person_email || 'colleague'), ...(d.person_email ? { email: String(d.person_email) } : {}),
    why: d.by_rule ? 'forwarded by your rule' : 'delegated through Suzi', since: new Date().toISOString(),
  };
}
