import { describe, it, expect } from 'vitest';
import { extractWikiLinks, titleKey, wikiLink } from '../src/services/wiki/wikiLinks';

describe('wikiLinks', () => {
  it('reads plain, aliased and heading links, once each, in order', () => {
    const links = extractWikiLinks('See [[Project X]], [[Ali  Khan|Ali]] and [[project x#Budget]]. [[ ]] [[]]');
    expect(links).toEqual([
      { title: 'Project X', key: 'project x', alias: null },
      { title: 'Ali Khan', key: 'ali khan', alias: 'Ali' },
    ]);
  });
  it('skips code, and copes with empty input', () => {
    expect(extractWikiLinks('`[[A]]` ```\n[[B]]\n``` [[C]]').map((l) => l.title)).toEqual(['C']);
    expect(extractWikiLinks(null)).toEqual([]);
  });
  it('writes a link that reads back as the same title', () => {
    expect(extractWikiLinks(wikiLink('Acme [Pvt] | Ltd'))[0].key).toBe(titleKey('Acme Pvt Ltd'));
    expect(wikiLink('Ali Khan', 'Ali')).toBe('[[Ali Khan|Ali]]');
  });
});
