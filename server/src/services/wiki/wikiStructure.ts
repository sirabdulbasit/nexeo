/**
 * The Wiki's standard structure (founder, 25 Nov 2026: "Wiki should have standard structure (like obsidian)
 * and all data will remain recorded/saved as per the structure, all other feeds and integration data will be
 * landed accordingly"). Wiki-Knowledge §0.31.
 *
 * A note is one thing, titled by its name, of one of the types below. What was fetched (an email, a chat
 * message, an integration row) is a SOURCE that notes cite, never a note of its own. This list is the only
 * place a note type is allowed; the database trigger `wiki_notes_standard_types` holds the same list, and
 * `tests/wikiStructure.test.ts` fails if the two, or §0.31, disagree.
 */

export const NOTE_TYPES = [
  'person', 'company', 'group', 'meeting', 'project', 'topic', 'decision', 'commitment',
  'document', 'conversation', 'rule', 'learned', 'system', 'kpi', 'business_unit',
] as const;

export type NoteType = typeof NOTE_TYPES[number];

const ALLOWED = new Set<string>(NOTE_TYPES);

export function isNoteType(t: unknown): t is NoteType {
  return typeof t === 'string' && ALLOWED.has(t);
}

export class NonStandardNote extends Error {
  readonly code = 'wiki_structure';
  constructor(readonly type: string) {
    super(`wiki_structure: "${type}" is not a Wiki note type. Land the data as a source (wikiSources.saveSource) and let a note cite it (Wiki-Knowledge §0.31)`);
  }
}

/** Refuse a note whose type is not in the standard structure. */
export function assertNoteStructure(input: { type: string }): void {
  if (!isNoteType(input.type)) throw new NonStandardNote(input.type);
}

/**
 * Fields of an integration row that never reach a note: personal data beyond what a colleague needs
 * (founder not yet asked otherwise; §0.31). The source keeps them, readable by the client's users through sources only.
 */
export const SENSITIVE_FIELD = /birth|\bdob\b|gender|sex|salary|wage|\bpay\b|cnic|\bnic\b|national|passport|religion|marital|bank|iban|account_?no|contract/i;
