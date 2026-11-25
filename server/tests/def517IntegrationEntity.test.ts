import { describe, it, expect } from 'vitest';
import { readContextTransform, inferContextEntity, planContextPages } from '../src/services/integrations/engine/contextWriter';
import { readContextProposal } from '../src/services/integrations/mapping/aiProposer';
// @ts-ignore client JS
import { describeTransform } from '../../client/src/pages/admin/integrations/integrationUi.jsx';

const integ = { id: 'i1', name: 'Projects' };
const rec = [{ Project: 'Apollo', Owner: 'Ali', Status: 'Open' }];
const row = (t: any) => ({ suggestionId: 's1', targetKey: 'context:per_record', transform: t }) as any;

describe('DEF-517 every row says what it is (Wiki contract)', () => {
  it('reader keeps a valid entity and idField, drops an unknown one', () => {
    expect(readContextTransform({ mode: 'per_record', titleField: 'a', bodyFields: ['b'], entity: 'project', idField: 'id' }))
      .toEqual({ mode: 'per_record', titleField: 'a', bodyFields: ['b'], entity: 'project', idField: 'id' });
    expect(readContextTransform({ mode: 'per_record', titleField: 'a', bodyFields: ['b'], entity: 'planet' })).toEqual({ mode: 'per_record', titleField: 'a', bodyFields: ['b'] });
  });
  it('infers from field names', () => {
    expect(inferContextEntity(['Full Name', 'Email', 'Company'])).toBe('person');
    expect(inferContextEntity(['Task', 'Due date', 'Owner'])).toBe('commitment');
    expect(inferContextEntity(['Project', 'Status'])).toBe('project');
    expect(inferContextEntity(['Vendor', 'Website'])).toBe('company');
    expect(inferContextEntity(['Amount', 'Month'])).toBe('none');
  });
  it('proposal keeps the AI entity, else infers', () => {
    const h = ['Project', 'Owner', 'Status'];
    const a = readContextProposal({ kind: 'context', targetKey: 'context:per_record', transform: { mode: 'per_record', titleField: 'Project', bodyFields: ['Owner'], entity: 'topic' } } as any, h) as any;
    expect(a.transform.entity).toBe('topic');
    const b = readContextProposal({ kind: 'context', targetKey: 'context:per_record', transform: { mode: 'per_record', titleField: 'Project', bodyFields: ['Owner', 'Status'] } } as any, h) as any;
    expect(b.transform.entity).toBe('project');
  });
  it('entity changes the hash (re-lands once); no entity keeps the legacy hash', () => {
    const base = planContextPages(integ, rec, [row({ mode: 'per_record', titleField: 'Project', bodyFields: ['Owner', 'Status'] })], null, 10).pages[0];
    const ent = planContextPages(integ, rec, [row({ mode: 'per_record', titleField: 'Project', bodyFields: ['Owner', 'Status'], entity: 'project' })], null, 10).pages[0] as any;
    expect(base.body).toBe(ent.body);
    expect(base.contentHash).not.toBe(ent.contentHash);
    expect(ent.entity).toBe('project');
    expect((base as any).entity).toBeUndefined();
  });
  it('the Map step says where each row goes', () => {
    expect(describeTransform({ mode: 'per_record', titleField: 'Project', bodyFields: ['Owner'], entity: 'project' })).toContain('Each row is a: Project (goes to Projects)');
  });
});
