import { describe, expect, it } from 'vitest';
import { buildStylesheet } from '../src/components/graph/stylesheet';

describe('buildStylesheet', () => {
  it('浅色主题包含节点/边/焦点/搜索/域等全部选择器', () => {
    const sheet = buildStylesheet(false);
    const selectors = sheet.map((entry) => entry.selector);
    expect(selectors).toEqual(
      expect.arrayContaining([
        'node',
        'node[entityType = "task"]',
        'node[entityType = "project"]',
        'node[entityType = "spec"]',
        'node[entityType = "spec"][scope = "global"]',
        'node[entityType = "spec"][scope = "user"]',
        'node[entityType = "spec"][scope = "project"]',
        'node[isDomain = "true"]',
        '.dimmed',
        '.search-match',
        '.search-current',
        '.minimap-hover',
        '.focused',
        '.focused.pulse',
        'edge',
        'edge.dimmed',
        "edge[label = 'same-project']",
        "edge[label = 'cross-user']",
        'edge.highlighted',
        'edge.hovered',
        'edge.highlighted.hovered',
      ]),
    );

    const nodeStyle = sheet.find((entry) => entry.selector === 'node')?.style as Record<
      string,
      unknown
    >;
    expect(nodeStyle['background-color']).toBe('#F7F7F5');
    expect(nodeStyle.color).toBe('#2A2A32');
    const edgeStyle = sheet.find((entry) => entry.selector === 'edge')?.style as Record<
      string,
      unknown
    >;
    expect(edgeStyle['line-color']).toBe('#D8D8D6');
    expect(edgeStyle.color).toBe('#555');
  });

  it('深色主题使用深色底/浅色文字', () => {
    const sheet = buildStylesheet(true);
    const nodeStyle = sheet.find((entry) => entry.selector === 'node')?.style as Record<
      string,
      unknown
    >;
    expect(nodeStyle['background-color']).toBe('#32323C');
    expect(nodeStyle.color).toBe('#EAEAF0');
    const edgeStyle = sheet.find((entry) => entry.selector === 'edge')?.style as Record<
      string,
      unknown
    >;
    expect(edgeStyle['line-color']).toBe('#44444F');
    expect(edgeStyle.color).toBe('#A0A0B0');
    expect(edgeStyle['text-background-color']).toBe('#282830');
  });
});
