/**
 * DEF-438 — the owner could not get the employee directory connected (11-12 screenshot:
 * "The web address is still the document's example (your-domain.com)"), although vm
 * reads the same API. Two traps, both pinned here on the real document layout:
 *
 *  1. The model drafts the example host (printed in four code samples) over the real
 *     one (printed once on the "URL" line). adoptDocumentAddress takes the real origin
 *     in code when exactly one is printed for the drafted endpoint.
 *  2. The Connect form loads the SAVED config first, so a saved example address hid a
 *     later reading's real one. initialForm now lets a real draft address replace a
 *     saved example address — and nothing else.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
vi.mock('../src/services/llmRouter', () => ({ callLLM: async () => ({ text: '{}', provider: 'gemini' }) }));
vi.mock('../src/db/prisma', () => ({ __esModule: true, default: {} }));

import { adoptDocumentAddress, redactSecrets } from '../src/services/integrations/sources/docReader';
import * as logic from '../../client/src/pages/admin/integrations/integrationLogic.js';

const DOC = redactSecrets([
  'Endpoint',
  'Method GET',
  'URL https://erp.tmcltd.com:5004/taql/api/employee/directory',
  'Auth API Key (x-api-key header)',
  'curl -X GET "https://your-domain.com/taql/api/employee/directory" \\',
  'url = "https://your-domain.com/taql/api/employee/directory"',
  'const response = await fetch("https://your-domain.com/taql/api/employee/directory")',
  '• Enter URL: https://your-domain.com/taql/api/employee/directory',
  '"profilePicture": "https://cdn.example.com/pics/101.jpg",',
  'Support: https://tmcltd.com/contact',
].join('\n')).text;

const MODEL = {
  draft: { baseUrl: 'https://your-domain.com', path: '/taql/api/employee/directory', authScheme: 'API_KEY' as const },
  gaps: [
    'The API returns all employees in a single list and does not support paging.',
    "The base URL 'https://your-domain.com' is a placeholder; the correct one needs to be provided.",
    'The address in the document (your-domain.com) is an example — replace it with your system\'s real web address (keep the path after it).',
  ],
};

describe('DEF-438 the real address, read in code', () => {
  it('takes the one real origin the document prints for the drafted endpoint', () => {
    const out = adoptDocumentAddress(DOC, MODEL);
    expect(out.draft.baseUrl).toBe('https://erp.tmcltd.com:5004');
    expect(out.draft.path).toBe('/taql/api/employee/directory');
  });

  it('replaces the example-address gaps with one note naming both', () => {
    const out = adoptDocumentAddress(DOC, MODEL);
    expect(out.gaps.some((g) => /placeholder|is an example/.test(g))).toBe(false);
    expect(out.gaps[0]).toContain('erp.tmcltd.com:5004');
    expect(out.gaps).toContain('The API returns all employees in a single list and does not support paging.');
  });

  it('keeps a draft prefix: base "/taql/api" + path "/employee/directory"', () => {
    const out = adoptDocumentAddress(DOC, { draft: { baseUrl: 'https://your-domain.com/taql/api', path: '/employee/directory' }, gaps: [] });
    expect(out.draft.baseUrl).toBe('https://erp.tmcltd.com:5004/taql/api');
  });

  it('guesses nothing when two real origins name the endpoint', () => {
    const two = `${DOC}\nStaging https://erp-test.tmcltd.com:5004/taql/api/employee/directory`;
    expect(adoptDocumentAddress(two, MODEL).draft.baseUrl).toBe('https://your-domain.com');
  });

  it('guesses nothing when the document prints no real address (old redacted text)', () => {
    const old = DOC.replace('https://erp.tmcltd.com:5004/taql/api/employee/directory', 'https://erp.tmcltd.com:[redacted]');
    expect(adoptDocumentAddress(old, MODEL).draft.baseUrl).toBe('https://your-domain.com');
  });

  it('leaves a real drafted address alone', () => {
    const real = { draft: { baseUrl: 'https://api.vendor.io', path: '/v1/items' }, gaps: ['x'] };
    expect(adoptDocumentAddress(DOC, real)).toEqual(real);
  });
});

describe('DEF-438 the Connect form takes the real address over a saved example', () => {
  const saved = { baseUrl: 'https://your-domain.com', path: '/taql/api/employee/directory', method: 'GET', authScheme: 'API_KEY', authHeaderName: 'x-api-key', recordsPath: 'data', idField: 'id', pagination: { kind: 'none' } };
  const reading = { draft: { baseUrl: 'https://erp.tmcltd.com:5004', path: '/taql/api/employee/directory' } };

  it('a saved example address gives way to the reading\'s real one, and the form is dirty', () => {
    const f = logic.initialForm({ apiConfig: saved, apiDocReading: reading });
    expect(f.baseUrl).toBe('https://erp.tmcltd.com:5004');
    expect(f.recordsPath).toBe('data');
    expect(logic.isConfigDirty(f, saved)).toBe(true);
  });

  it('a saved REAL address is never replaced by a reading', () => {
    const mine = { ...saved, baseUrl: 'https://erp.internal-gw.tmcltd.com' };
    expect(logic.initialForm({ apiConfig: mine, apiDocReading: reading }).baseUrl).toBe('https://erp.internal-gw.tmcltd.com');
  });

  it('an example address in the reading never replaces anything', () => {
    expect(logic.initialForm({ apiConfig: saved, apiDocReading: { draft: { baseUrl: 'https://api.example.com' } } }).baseUrl).toBe('https://your-domain.com');
  });

  it('the client and server agree on what an example address is', async () => {
    const { placeholderHost } = await import('../src/services/integrations/sources/apiReader');
    for (const u of ['https://your-domain.com', 'https://api.example.com', 'https://mycompany.com', 'https://erp.tmcltd.com:5004', 'https://sample.io']) {
      expect(logic.isPlaceholderAddress(u)).toBe(!!placeholderHost(u));
    }
  });
});
