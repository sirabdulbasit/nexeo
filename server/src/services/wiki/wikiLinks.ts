/**
 * Wiki links — the `[[Title]]` syntax, as Obsidian writes it.
 *
 * The note text is the truth for links: `wikiStore.writeNote` reads the links
 * out of the body with this module and rebuilds the link rows from them.
 * Pure functions only; no database.
 */

export interface WikiLink {
  /** The title as written, trimmed. */
  title: string;
  /** Lower-cased, whitespace-collapsed title: the key two spellings share. */
  key: string;
  /** Display text from `[[Title|shown text]]`, when given. */
  alias: string | null;
}

/** The key two spellings of one title share: trimmed, single-spaced, lower case. */
export function titleKey(title: string): string {
  return (title ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** A title as stored: trimmed, single-spaced, at most 300 characters (the column width). */
export function cleanTitle(title: string): string {
  return (title ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Blank out fenced and inline code, so a `[[x]]` shown as code is not a link. */
function withoutCode(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

/**
 * Every distinct link in a note body, in order of first appearance.
 * Understands `[[Title]]`, `[[Title|shown text]]` and `[[Title#Heading]]`
 * (the heading part is dropped: the link is to the note).
 */
export function extractWikiLinks(body: string | null | undefined): WikiLink[] {
  if (!body) return [];
  const seen = new Set<string>();
  const out: WikiLink[] = [];
  const re = /\[\[([^\[\]\n]+?)\]\]/g;
  const text = withoutCode(body);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const [target, ...aliasParts] = m[1].split('|');
    const title = cleanTitle(target.split('#')[0]);
    const key = titleKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const alias = aliasParts.join('|').trim();
    out.push({ title, key, alias: alias || null });
  }
  return out;
}

/** Write a link to a title, escaping nothing: titles never contain `[`, `]` or `|`. */
export function wikiLink(title: string, alias?: string): string {
  const t = cleanTitle(title).replace(/[\[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
  return alias ? `[[${t}|${alias}]]` : `[[${t}]]`;
}
