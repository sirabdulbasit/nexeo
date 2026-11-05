/**
 * Founder, 5 Nov: reading the subject isn't explaining an email; "it should tell what inside this email and whats
 * the point". Triage already read each email and wrote why it matters, in English, so no model runs here.
 */
const MAX_SUMMARY = 200;

/** Triage's fallbacks describe its own reasoning, not the email. */
const NOT_ABOUT_THE_EMAIL = /^(no prior pattern|md chose|gate rule|automated|self-authored|sender |star this)/i;

interface TriageRead {
  rationale?: string | null;
  suggestedAction?: string | null;
  suggestedDelegateeName?: string | null;
}

function cut(text: string): string {
  if (text.length <= MAX_SUMMARY) return text;
  const part = text.slice(0, MAX_SUMMARY);
  const sentence = Math.max(part.lastIndexOf('. '), part.lastIndexOf('? '));
  if (sentence > MAX_SUMMARY / 2) return part.slice(0, sentence + 1);
  return `${part.slice(0, part.lastIndexOf(' ')).trimEnd()} …`;
}

export function emailGist(item: TriageRead): { summary?: string; point?: string } {
  const line = String(item.rationale ?? '').split('\n')[0].trim();
  if (!line || NOT_ABOUT_THE_EMAIL.test(line)) return {};
  const point =
    item.suggestedAction === 'draft_reply' ? 'It needs your reply.'
    : item.suggestedAction === 'delegate' ? (item.suggestedDelegateeName ? `${item.suggestedDelegateeName} could handle it.` : 'Someone else could handle it.')
    : item.suggestedAction === 'add_open_item' ? 'It needs action, not a reply.'
    : undefined;
  return { summary: cut(line), ...(point ? { point } : {}) };
}
