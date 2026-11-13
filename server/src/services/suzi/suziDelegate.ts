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

/** The note to the person: an email from his mailbox, through the send gate. */
async function tell(
  clientNumber: string, userId: number, gate: SendGate,
  t: { itemId: string; title: string; due: string | null; note: string; person: { name: string; email: string } },
): Promise<{ told: boolean; draft_id?: string; undo_until?: string; error?: string }> {
  const owner = await ownerName(clientNumber, userId);
  const body = await writeWithModel(clientNumber, userId,
    `Write a short email from ${owner} to ${t.person.name}, handing them this task.\nTask: ${t.title}\n` +
    `${t.due ? `Due: ${t.due}\n` : ''}${t.note ? `What ${owner} wants said: ${t.note}\n` : ''}` +
    'Say plainly that the task is now theirs. Add nothing that is not given here.');
  const draft = await saveNewDraft(clientNumber, userId, { to: t.person.email, subject: `Task: ${t.title}`.slice(0, 200), body, mode: 'new' }, { tellOpenItemId: t.itemId });
  if (!draft.ok) return { told: false, error: draft.error };
  const draftId = (draft.item as any).draft_id;
  const sent = await saveToGmailDrafts(clientNumber, userId, { draft_id: draftId }, true, gate);
  if (!sent.ok) return { told: false, draft_id: draftId, error: sent.error };
  const i: any = sent.item;
  return i.sent ? { told: true, draft_id: draftId, undo_until: i.undo_until } : { told: false, draft_id: draftId };
}

async function forwardTask(clientNumber: string, userId: number, id: string, a: Args, gate: SendGate, timezone?: string): Promise<Result> {
  const person = await personById(clientNumber, userId, text(a.person_id));
  if (!person) return fail('not_found', 'no such person');
  if (!person.email) return fail('no_email', 'telling the person needs their email on record');
  const r = await applyFollowUp(clientNumber, userId, { actionId: id, update: 'assign', personId: person.id, note: text(a.note) || undefined, timezone });
  if (!r.ok) return fail(r.error, r.detail);
  const told = await tell(clientNumber, userId, gate, { itemId: id, title: r.action.title, due: r.action.due, note: text(a.note), person: { name: person.name, email: person.email } });
  return { ok: true, item: { ...r.action, told } };
}

/** F-2.2: task.update {update: "forward"}. Confirmation is needed because someone is told. */
export async function taskForward(clientNumber: string, userId: number, a: Args, confirmed: boolean, gate: SendGate, timezone?: string): Promise<Result> {
  if (!confirmed) return fail('needs_confirmation');
  return forwardTask(clientNumber, userId, text(a.id), a, gate, timezone);
}

/** F-2.1 */
export async function taskCreate(clientNumber: string, userId: number, a: Args, confirmed: boolean, gate: SendGate, timezone?: string): Promise<Result> {
  const title = text(a.title).slice(0, 200);
  if (!title) return fail('bad_title');
  const due = text(a.due);
  if (due && (!DAY.test(due) || isNaN(Date.parse(`${due}T12:00:00Z`)))) return fail('bad_date');
  const personId = text(a.person_id);
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
  if (personId) return withItem(await forwardTask(clientNumber, userId, item.id, { person_id: personId, note }, gate, timezone));
  const r = await applyFollowUp(clientNumber, userId, { actionId: item.id, update: 'note', note: note || 'Created through Suzi', timezone });
  return withItem(r.ok ? { ok: true, item: r.action } : { ok: true, item: { id: item.id, title } });
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
    const delegate = { thread_id: threadId, person_id: person.id, person_name: person.name, person_email: person.email, note: text(a.note), subject: mail.subject, rule_id: ruleId || null };
    await prisma.agentAction.update({ where: { id: row.id }, data: { input: { ...(row.input as any), delegate } as any } as any });
  }
  const sent = await saveToGmailDrafts(clientNumber, userId, { draft_id: draftId }, true, gate);
  if (!sent.ok) return sent;
  const i: any = sent.item;
  return {
    ok: true,
    item: i.sent
      ? { state: 'held', draft_id: draftId, undo_until: i.undo_until, person_name: person.name, attachments_left_out: (fwd.item as any).attachments_left_out }
      : { state: 'saved', draft_id: draftId, saved_to_gmail_drafts: true, sent: false, person_name: person.name },
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
  if (inp.tellOpenItemId) {
    await prisma.openItem.updateMany({ where: { id: String(inp.tellOpenItemId), clientNumber: row.clientNumber, userId: row.userId as any }, data: told });
    return;
  }
  const d = inp.delegate;
  if (!d?.person_id) return;
  const { createItem, delegateItem, changeStatus } = await import('../openItemsService');
  const item = await createItem(row.userId as any, row.clientNumber, {
    title: `${d.subject || 'Email'}`.slice(0, 200), type: 'task', priority: 'medium', sourceFeed: 'suzi',
    ...(d.note ? { description: String(d.note).slice(0, 2000) } : {}),
    metadata: { manualCreate: true, createdBy: 'suzi', suziSource: { email_id: d.thread_id }, ...(d.rule_id ? { suziRule: d.rule_id } : {}) },
  } as any);
  if (!item?.id) return;
  const actor = `user:${row.userId}`;
  if (String(item.status ?? '').toUpperCase() === 'NEW') await changeStatus(item.id, row.clientNumber, 'TRIAGED' as any, `Delegating to ${d.person_name}`, actor);
  await delegateItem(item.id, row.clientNumber, null, d.person_name, d.person_email, d.note || 'Delegated through Suzi', actor);
  await prisma.openItem.update({ where: { id: item.id }, data: told });
  await prisma.$executeRawUnsafe(
    `UPDATE agent_actions SET output = jsonb_set(output, '{send}', (output->'send') || $2::jsonb), updated_at = now() WHERE id = $1`,
    draftId, JSON.stringify({ task_id: item.id }),
  );
  // It is his no longer: the thread leaves the emails needing a reply.
  const { runEmailOp } = await import('./suziEmail');
  await runEmailOp(row.clientNumber, row.userId as any, 'email.mark', { thread_id: d.thread_id, state: 'handled' }, true).catch(() => undefined);
}
