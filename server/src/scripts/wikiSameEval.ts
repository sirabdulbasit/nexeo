/**
 * Measures the model's "are these the same?" answers (wiki/wikiSame.ts) on a labelled set, with the
 * production prompts and model. The unit tests prove the gate (no answer = separate); they cannot prove
 * the model judges meaning correctly. This does not prove it either: it MEASURES it on these cases.
 *
 *   npx tsx src/scripts/wikiSameEval.ts [runs]
 *
 * Reports false merges (labelled different, answered same and sure) and missed matches (labelled same,
 * not merged). A missed match costs a duplicate note; a false merge loses a distinction, so it is the
 * number that matters. Add every case a review or a user finds to this set.
 */
import { SAME_TASK_SYSTEM } from '../services/wiki/wikiMeaning';
import { SAME_DOC_SYSTEM, SAME_DOC_CHALLENGE, SAME_DOC_SECOND } from '../services/wiki/wikiDocuments';
import { parseVerdict, show, SAME_MODEL } from '../services/wiki/wikiSame';

type Label = 'same' | 'different' | 'ambiguous';
interface Case { kind: string; label: Label; a: Record<string, unknown>; b: Record<string, unknown> }

const t = (kind: string, label: Label, a: string, b: string, xa: Record<string, unknown> = {}, xb: Record<string, unknown> = {}): Case => ({
  kind, label,
  a: { what: a, owner: 'fida@acme.com', state: 'open', conversation: 'Payroll and operations', date: '2026-11-10', ...xa },
  b: { what: b, owner: 'fida@acme.com', state: 'open', conversation: 'Re: Payroll and operations', date: '2026-11-12', ...xb },
});

export const TASK_CASES: Case[] = [
  t('opposite', 'different', 'Approve payroll release', 'Reject payroll release'),
  t('opposite', 'different', 'Cancel the Lahore workshop', 'Confirm the Lahore workshop'),
  t('opposite', 'different', 'Increase the cloud budget', 'Cut the cloud budget'),
  t('opposite', 'different', 'Hire the payroll analyst', 'Dismiss the payroll analyst'),
  t('negation', 'different', 'Send the payroll sheet to finance', 'Do not send the payroll sheet to finance'),
  t('negation', 'different', 'Share the draft with the client', 'Hold the draft; it must not go to the client yet'),
  t('recurring', 'different', 'Submit November payroll report', 'Submit December payroll report'),
  t('recurring', 'different', 'Send the Q3 board pack', 'Send the Q4 board pack'),
  t('recurring', 'different', 'Send the weekly status for week 45', 'Send the weekly status for week 46'),
  t('recurring', 'different', 'Approve the August timesheets', 'Approve the September timesheets'),
  t('other object', 'different', 'Pay invoice INV-1041', 'Pay invoice INV-1042'),
  t('other object', 'different', "Approve Hussain Ahmed's August missing timesheet", "Approve Mashal Fida's August missing timesheet"),
  t('other object', 'different', 'Renew the SAP licence for Sapphire', 'Renew the SAP licence for Soorty'),
  t('other object', 'different', 'Share the payroll summary with the board', 'Share the payroll summary with the auditors'),
  t('other object', 'different', 'Book the flights for the Dubai visit', 'Book the hotel for the Dubai visit'),
  t('other action', 'different', 'Draft the proposal for Alpha', 'Review the proposal for Alpha'),
  t('other action', 'different', 'Schedule the Vision Metric training session', 'Share the recording of the Vision Metric training session'),
  t('other action', 'different', 'Implement the systems catalogue', 'Send a calendar invite to discuss the source of the systems catalogue'),
  t('other action', 'different', 'Extend the Imperialsoft credits', 'Move the services that use Imperialsoft credits to the new account'),
  t('other owner', 'different', 'Prepare the audit file', 'Prepare the audit file', {}, { owner: 'omar@acme.com' }),
  t('paraphrase', 'same', 'Send the October payroll sheet to finance', 'Send finance the payroll sheet for October'),
  t('paraphrase', 'same', 'Send Haseeb your comments on the Travel Booking Audit spec', 'Share comments on the travel booking audit specification with Haseeb'),
  t('paraphrase', 'same', 'Get a downtime slot for the CPU upgrade from infra', 'Ask the infra team for a downtime window for the CPU upgrade'),
  t('paraphrase', 'same', 'Prepare the audit file for FY25', 'Get the FY25 audit file ready'),
  t('paraphrase', 'same', 'Call Rashid about the EAM data issue', 'Phone Rashid regarding the issue with the EAM data'),
  t('paraphrase', 'same', 'Submit November payroll report', 'November payroll report to be submitted by the 20th', { due: '2026-11-20' }, { due: '2026-11-20' }),
  t('task list', 'same', "Approve or reject Hussain Ahmed's August missing-timesheet request", 'Approve missing timesheet request for Hussain Ahmed for August 2026', { from: 'his task list', his_word: 'closed', owner: null }),
  t('task list', 'same', 'Give Salman Amin a downtime slot for the deepmarks CPU upgrade', 'Give Salman a downtime slot for the CPU upgrade of deepmarks', { from: 'his task list', his_word: 'his own open task', owner: null }),
  t('completion', 'same', 'Share the signed NDA with Soorty', 'Signed NDA shared with Soorty', {}, { owner: null, state: 'done', evidence: 'sent the signed NDA to Soorty this morning' }),
  t('completion', 'same', 'Renew the domain tmcltd.ai before it expires', 'Domain tmcltd.ai renewal', {}, { owner: null, state: 'done', evidence: 'renewed for two years today' }),
  t('other language', 'same', 'Complete the testing of the IMAX import and export solution', 'آئی میکس امپورٹ اور ایکسپورٹ کا سولیوشن ٹیسٹ کر کے مکمل کرنا'),
  t('unclear', 'ambiguous', 'Resolve the pending issue', 'Resolve the pending delivery issue'),
  t('unclear', 'ambiguous', 'Follow up with the vendor', 'Follow up with the vendor on the invoice'),
  t('unclear', 'ambiguous', 'Fill in the project form', 'Fill in the sponsor confirmation form'),
];

const d = (kind: string, label: Label, a: Record<string, unknown>, b: Record<string, unknown>): Case => ({
  kind, label,
  a: { file: 'Document.pdf', from: 'Ali Khan <ali@vendor-a.com>', date: '2026-11-01', conversation: 't1', ...a },
  b: { file: 'Document.pdf', from: 'Ali Khan <ali@vendor-a.com>', date: '2026-11-08', conversation: 't1', ...b },
});
const INV = (n: string, amount: string, period: string, issuer = 'Vendor A (Pvt) Ltd') => `${issuer}\nTAX INVOICE\nInvoice No: ${n}\nBill to: TMC Private Limited\nServices rendered for ${period}\nTotal due: PKR ${amount}`;

export const DOC_CASES: Case[] = [
  d('next invoice, one vendor', 'different',
    { reference_numbers: 'inv-001', opening: INV('INV-001', '450,000', 'October 2026'), lines_only_in_this_one: 'Invoice No: INV-001\nServices rendered for October 2026\nTotal due: PKR 450,000' },
    { reference_numbers: 'inv-002', opening: INV('INV-002', '470,000', 'November 2026'), lines_only_in_this_one: 'Invoice No: INV-002\nServices rendered for November 2026\nTotal due: PKR 470,000' }),
  d('same number, two issuers', 'different',
    { reference_numbers: 'inv-001', opening: INV('INV-001', '450,000', 'October 2026'), lines_only_in_this_one: 'Vendor A (Pvt) Ltd\nTotal due: PKR 450,000' },
    { from: 'Sara Malik <sara@vendor-b.com>', conversation: 't2', reference_numbers: 'inv-001', opening: INV('INV-001', '90,000', 'October 2026', 'Vendor B Traders'), lines_only_in_this_one: 'Vendor B Traders\nTotal due: PKR 90,000' }),
  d('same number, same amount, two issuers', 'different',
    { reference_numbers: 'inv-001', opening: INV('INV-001', '450,000', 'October 2026'), lines_only_in_this_one: 'Vendor A (Pvt) Ltd' },
    { from: 'Sara Malik <sara@vendor-b.com>', reference_numbers: 'inv-001', opening: INV('INV-001', '450,000', 'October 2026', 'Vendor B Traders'), lines_only_in_this_one: 'Vendor B Traders' }),
  d('next month report', 'different',
    { opening: 'Monthly operations report\nPeriod: October 2026\nHeadcount 412\nNew hires 12', lines_only_in_this_one: 'Period: October 2026\nHeadcount 412\nNew hires 12' },
    { opening: 'Monthly operations report\nPeriod: November 2026\nHeadcount 419\nNew hires 9', lines_only_in_this_one: 'Period: November 2026\nHeadcount 419\nNew hires 9' }),
  d('other party', 'different',
    { opening: 'Master services agreement\nbetween TMC Private Limited and Alpha Textiles', lines_only_in_this_one: 'between TMC Private Limited and Alpha Textiles\nClause 14: the customer is Alpha Textiles.' },
    { opening: 'Master services agreement\nbetween TMC Private Limited and Beta Mills', lines_only_in_this_one: 'between TMC Private Limited and Beta Mills\nClause 14: the customer is Beta Mills.' }),
  d('other person', 'different',
    { opening: 'Payslip\nEmployee: Hussain Ahmed (E-1201)\nMonth: October 2026\nNet pay: 182,000', lines_only_in_this_one: 'Employee: Hussain Ahmed (E-1201)\nNet pay: 182,000' },
    { opening: 'Payslip\nEmployee: Mashal Fida (E-1346)\nMonth: October 2026\nNet pay: 174,500', lines_only_in_this_one: 'Employee: Mashal Fida (E-1346)\nNet pay: 174,500' }),
  d('late difference only', 'different',
    { opening: 'Supply agreement\nThe parties agree as follows. Standard terms apply.', lines_only_in_this_one: 'Schedule 3: delivery site is the Lahore plant; term ends 31 December 2026.' },
    { opening: 'Supply agreement\nThe parties agree as follows. Standard terms apply.', lines_only_in_this_one: 'Schedule 3: delivery site is the Karachi plant; term ends 30 June 2027; purchase order PO-7731.' }),
  d('other quotation', 'different',
    { reference_numbers: 'q-17', opening: 'Quotation Q-17\n10 scanners at 85,000 each', lines_only_in_this_one: 'Quotation Q-17\n10 scanners at 85,000 each' },
    { reference_numbers: 'q-18', opening: 'Quotation Q-18\n20 laptops at 310,000 each', lines_only_in_this_one: 'Quotation Q-18\n20 laptops at 310,000 each' }),
  d('revised invoice', 'same',
    { reference_numbers: 'inv-001', opening: INV('INV-001', '450,000', 'October 2026'), lines_only_in_this_one: 'Total due: PKR 450,000' },
    { came_with: 'Revised invoice INV-001 (corrected tax)', reference_numbers: 'inv-001', opening: `${INV('INV-001', '459,000', 'October 2026')}\nREVISED: replaces the copy sent on 1 November`, lines_only_in_this_one: 'Total due: PKR 459,000\nREVISED: replaces the copy sent on 1 November' }),
  d('revised draft', 'same',
    { opening: 'SAP Compliance Agent: design document\nDraft 1\n1. Summary\n2. Scope', lines_only_in_this_one: 'Draft 1' },
    { came_with: 'Design document, updated after your comments', opening: 'SAP Compliance Agent: design document\nDraft 2\n1. Summary\n2. Scope\n3. Risks (added after review)', lines_only_in_this_one: 'Draft 2\n3. Risks (added after review)' }),
  d('typo fixed', 'same',
    { opening: 'Minutes of the leadership cadence call, 13 November 2026\nAttendees: Basit, Fida, Numair', lines_only_in_this_one: 'Action: Numair to share the catalouge by Friday.' },
    { opening: 'Minutes of the leadership cadence call, 13 November 2026\nAttendees: Basit, Fida, Numair', lines_only_in_this_one: 'Action: Numair to share the catalogue by Friday.' }),
  d('re-sent with one line added', 'same',
    { opening: 'Project closure checklist: ECP Payroll\n1. Sign-off received', lines_only_in_this_one: '(none: every line of this one is also in the other)' },
    { opening: 'Project closure checklist: ECP Payroll\n1. Sign-off received', lines_only_in_this_one: '7. Archive the project folder' }),
  d('unclear', 'ambiguous',
    { opening: 'Summary\nPoints discussed and next steps.', lines_only_in_this_one: 'Next step: share the plan.' },
    { opening: 'Summary\nPoints discussed and next steps.', lines_only_in_this_one: 'Next step: confirm the budget.' }),
];

async function main() {
  const runs = Math.max(1, Number(process.argv[2] ?? 1));
  const { callLLM } = await import('../services/llmRouter');
  // The production path: judgePairs itself, with its two readings, writing nothing.
  const { judgePairs } = await import('../services/wiki/wikiSame');
  const call = async (sys: string, msg: string) => (await callLLM(sys, msg, { providers: [SAME_MODEL as any], maxTokens: 200, timeoutMs: 45_000, purpose: 'wiki_same_eval' } as any)).text;
  let n = 0;
  const ask = async (sys: string, c: Case) => {
    const challenge = sys === SAME_DOC_SYSTEM ? SAME_DOC_CHALLENGE : undefined;
    const key = `eval:${n += 1}`;
    const verdicts = new Map<string, boolean>();
    const r = await judgePairs('EVAL', 0, [{ key, ids: ['a', 'b'], a: c.a, b: c.b, anchor: 'eval' }], verdicts, { system: sys, promptVersion: 'eval', purpose: 'wiki_same_eval', limit: 1, call, keep: false, challenge, ...(challenge ? { secondReadings: 2 } : {}),
      ...(challenge ? { secondCall: async (x: string, m: string) => (await callLLM(x, m, { providers: [SAME_DOC_SECOND as any], maxTokens: 400, timeoutMs: 60_000, purpose: 'wiki_same_eval' } as any)).text } : {}) });
    return r.failed ? null : { same: verdicts.get(key) === true, sure: true, why: '' };
  };
  const out: string[] = [];
  for (const [name, sys, cases] of [['tasks', SAME_TASK_SYSTEM, TASK_CASES], ['documents', SAME_DOC_SYSTEM, DOC_CASES]] as const) {
    let falseMerge = 0; let missed = 0; let failed = 0; let unstable = 0; let ambMerged = 0;
    const nSame = cases.filter((c) => c.label === 'same').length; const nDiff = cases.filter((c) => c.label === 'different').length; const nAmb = cases.filter((c) => c.label === 'ambiguous').length;
    for (const c of cases) {
      const merged: boolean[] = [];
      for (let i = 0; i < runs; i += 1) {
        const v = await ask(sys, c).catch(() => null);
        if (!v) { failed += 1; continue; }
        merged.push(v.same && v.sure);
      }
      const any = merged.some(Boolean); const all = merged.length > 0 && merged.every(Boolean);
      if (any !== all) unstable += 1;
      const what = String(c.a.what ?? c.kind);
      if (c.label === 'different' && any) { falseMerge += 1; out.push(`FALSE MERGE [${name}/${c.kind}] ${what} | ${String(c.b.what ?? '')}`); }
      if (c.label === 'same' && !all) { missed += 1; out.push(`missed match [${name}/${c.kind}] ${what} | ${String(c.b.what ?? '')}`); }
      if (c.label === 'ambiguous' && any) { ambMerged += 1; out.push(`merged an unclear pair [${name}/${c.kind}] ${what} | ${String(c.b.what ?? '')}`); }
    }
    console.log(`${name}: ${cases.length} labelled pairs x ${runs} run(s) | false merges ${falseMerge} of ${nDiff} different | missed matches ${missed} of ${nSame} same | unclear pairs merged ${ambMerged} of ${nAmb} | answers that changed between runs ${unstable} | failed calls ${failed}`);
  }
  for (const l of out) console.log(' ', l);
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error('FAILED', e); process.exit(1); });
