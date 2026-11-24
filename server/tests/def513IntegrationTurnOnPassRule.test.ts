/**
 * DEF-513 (24 Nov 2026): "Turn it on" stayed disabled after a test whose only
 * shortfall was the knowledge-page cap, although the server accepts exactly that
 * test (mappingStore.activate → isCapOnlyPartial). Client and server now share
 * one rule; this test pins the client side and that the server still holds it.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
// @ts-ignore — plain JS module from the client
import { testCountsAsPass } from '../../client/src/pages/admin/integrations/integrationLogic.js';

const CLIENT = path.resolve(__dirname, '../../client/src/pages/admin/integrations/StepTestTurnOn.jsx');
const STORE = path.resolve(__dirname, '../src/services/integrations/store/mappingStore.ts');

describe('DEF-513 turn-on pass rule matches the server', () => {
  it('SUCCESS counts', () => {
    expect(testCountsAsPass({ status: 'SUCCESS', result: {} })).toBe(true);
  });
  it('PARTIAL with a complete read cut only by the page cap counts', () => {
    expect(testCountsAsPass({ status: 'PARTIAL', result: { readComplete: true, context: { truncated: true } } })).toBe(true);
  });
  it('PARTIAL with an incomplete read does not count', () => {
    expect(testCountsAsPass({ status: 'PARTIAL', result: { readComplete: false, context: { truncated: true } } })).toBe(false);
    expect(testCountsAsPass({ status: 'PARTIAL', result: { context: { truncated: true } } })).toBe(false);
  });
  it('PARTIAL not caused by the page cap does not count', () => {
    expect(testCountsAsPass({ status: 'PARTIAL', result: { readComplete: true } })).toBe(false);
  });
  it('FAILED, ABORTED and no run do not count', () => {
    expect(testCountsAsPass({ status: 'FAILED', result: { readComplete: true, context: { truncated: true } } })).toBe(false);
    expect(testCountsAsPass({ status: 'ABORTED', result: {} })).toBe(false);
    expect(testCountsAsPass(null)).toBe(false);
  });
  it('the screen uses the shared rule, never a bare SUCCESS check', () => {
    const src = fs.readFileSync(CLIENT, 'utf8');
    expect(src).toContain('const passed = testCountsAsPass(run);');
    expect(src).not.toMatch(/const passed = run\?\.status === 'SUCCESS'/);
  });
  it('the server still applies the same rule (readComplete + context.truncated)', () => {
    const src = fs.readFileSync(STORE, 'utf8');
    expect(src).toMatch(/r\.readComplete === true && r\.context\?\.truncated === true/);
    expect(src).toMatch(/r\.status === 'SUCCESS' \|\| isCapOnlyPartial\(r\.result\)/);
  });
});
