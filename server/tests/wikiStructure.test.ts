/**
 * The Wiki's standard structure (founder, 25 Nov 2026; Wiki-Knowledge §0.31): one list of note types, held
 * the same in code, in the database trigger and in the document; raw rows are sources, never notes.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { NOTE_TYPES, assertNoteStructure, isNoteType, NonStandardNote, SENSITIVE_FIELD } from '../src/services/wiki/wikiStructure';

const root = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const sqlTypes = (sql: string) => [...sql.matchAll(/NOT IN\s*\(([^)]*)\)/g)].map((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort());

describe('Wiki standard structure', () => {
  it('refuses a raw integration record as a note, and anything off the list', () => {
    expect(() => assertNoteStructure({ type: 'org_doc' })).toThrow(NonStandardNote);
    expect(() => assertNoteStructure({ type: 'employee_row' })).toThrow(/land the data as a source/i);
    for (const t of NOTE_TYPES) expect(() => assertNoteStructure({ type: t })).not.toThrow();
    expect(isNoteType('person')).toBe(true);
  });

  it('the database trigger holds exactly the same list as the code (every list in the migration)', () => {
    const lists = sqlTypes(read('prisma/migrations/20261125_wiki_standard_structure/migration.sql'));
    expect(lists.length).toBe(3);
    for (const l of lists) expect(l).toEqual([...NOTE_TYPES].sort());
  });

  it('Wiki-Knowledge §0.31 lists every note type', () => {
    const doc = read('docs/Wiki-Knowledge.md');
    const sec = doc.slice(doc.indexOf('### 0.31'), doc.indexOf('\n### ', doc.indexOf('### 0.31') + 5));
    for (const t of NOTE_TYPES) expect(sec).toContain(`\`${t}\``);
  });

  it('both note doors check the structure', () => {
    const store = read('src/services/wiki/wikiStore.ts');
    expect(store.match(/assertNoteStructure\(/g)?.length).toBe(2);
  });

  it('integration rows land as sources, never adopted as notes', () => {
    const w = read('src/services/integrations/engine/contextWriter.ts');
    expect(w).not.toMatch(/adoptAsNote/);
    expect(w.match(/await landAsSource\(/g)?.length).toBe(2);
    expect(w).toMatch(/kind: 'record', scope: 'tenant'/);
  });

  it('personal fields are recognised as sensitive; work fields are not', () => {
    for (const k of ['dateOfBirth', 'gender', 'contractEndDate', 'contractType', 'salary', 'cnic', 'bankAccount']) expect(SENSITIVE_FIELD.test(k)).toBe(true);
    for (const k of ['designation', 'departmentName', 'reportsTo', 'businessUnit', 'phone', 'hierarchy']) expect(SENSITIVE_FIELD.test(k)).toBe(false);
  });
});
