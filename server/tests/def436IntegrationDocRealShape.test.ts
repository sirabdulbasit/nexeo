/**
 * DEF-436 — the owner's employee_directory_api.pdf, in the layout it REALLY has
 * (read back from the stored text, keys replaced by fakes). DEF-367 pinned an
 * invented "x-api-key: KEY" layout, so its fix passed its tests and still failed
 * on the real document (11-11: "here it is not connecting", vm connects):
 *
 *  1. "URL https://erp.tmcltd.com:5004/taql/api/employee/directory" kept whole —
 *     port + path read as one 32-char token and were blanked, so the reader only
 *     had the example host "your-domain.com".
 *  2. A key in a header table row "x-api-key  KEY  Your assigned API key" and in
 *     Postman steps "Key: x-api-key Value: KEY" is redacted AND kept as a
 *     candidate (they were stored as plain text and never tried).
 *  3. Words next to the header name ("x-api-key header)") stay.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
vi.mock('../src/services/llmRouter', () => ({ callLLM: async () => ({ text: '{}', provider: 'gemini' }) }));
vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {} }));

import { extractKeyCandidates, redactSecrets } from '../src/services/integrations/sources/docReader';

const TABLE_KEY = 'Fk7@PqrS#Lmn4821';
const POSTMAN_KEY = 'ABC@XYZ#2031';
const DOC = [
  'Endpoint',
  'Method GET',
  'URL https://erp.tmcltd.com:5004/taql/api/employee/directory',
  'Auth API Key (x-api-key header)',
  'Content-Type application/json',
  'Header Value Description',
  `x-api-key ${TABLE_KEY} Your assigned API key`,
  'curl -X GET "https://your-domain.com/taql/api/employee/directory" \\',
  '• Go to Headers tab and add:',
  `Key: x-api-key Value: ${POSTMAN_KEY}`,
  '"profilePicture": "https://cdn.example.com/pics/101.jpg",',
].join('\n');

describe('DEF-436 the real employee-directory document', () => {
  const { text } = redactSecrets(DOC);

  it('keeps the real address with its port and path', () => {
    expect(text).toContain('URL https://erp.tmcltd.com:5004/taql/api/employee/directory');
  });

  it('removes the table-row key and the Postman key from the stored text', () => {
    expect(text).not.toContain(TABLE_KEY);
    expect(text).not.toContain(POSTMAN_KEY);
    expect(text).toContain('x-api-key [redacted] Your assigned API key');
    expect(text).toContain('Key: x-api-key Value: [redacted]');
  });

  it('keeps both printed keys as candidates for the Connect test', () => {
    const keys = extractKeyCandidates(DOC);
    expect(keys).toContain(TABLE_KEY);
    expect(keys).toContain(POSTMAN_KEY);
    expect(keys).toHaveLength(2);
  });

  it('leaves words beside the header name alone', () => {
    expect(text).toContain('Auth API Key (x-api-key header)');
    expect(redactSecrets('Send x-api-key authentication on every call').text).toBe('Send x-api-key authentication on every call');
  });

  it('still blanks a token sitting in one segment of a URL with a port', () => {
    const tok = 'Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lm';
    const out = redactSecrets(`https://api.host.com:8443/v1/${tok}/items`).text;
    expect(out).toBe('https://api.host.com:8443/v1/[redacted]/items');
  });

  it('is idempotent', () => {
    expect(redactSecrets(text).text).toBe(text);
  });
});
