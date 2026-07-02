import type cytoscape from 'cytoscape';

/** Cytoscape 样式表：节点/边/Focus+Context/脉冲动效 */
export function buildStylesheet(isDark: boolean): cytoscape.Stylesheet[] {
  const bg = isDark ? '#25252E' : '#FFFFFF';
  const txt = isDark ? '#E8E8E8' : '#1D1D26';
  const ec = isDark ? '#3D3D48' : '#C8C8C8';

  return [
    {
      selector: 'node',
      style: {
        'shape': 'round-rectangle',
        'background-color': bg,
        'background-opacity': 0.95,
        'border-width': 2,
        'border-color': ec,
        'border-opacity': 0.8,
        'width': 'label',
        'height': 'label',
        'label': 'data(label)',
        'text-wrap': 'wrap',
        'text-max-width': '180px',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '10px',
        'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        'color': txt,
        'text-events': 'yes',
        'padding': '8px 12px',
      } as unknown as cytoscape.Css.Node,
    },
    {
      selector: 'node[entityType = "task"]',
      style: { 'border-color': 'data(color)', 'border-width': 2 } as unknown as cytoscape.Css.Node,
    },
    {
      selector: 'node[entityType = "project"]',
      style: { 'border-color': '#722ED1', 'border-width': 2 } as unknown as cytoscape.Css.Node,
    },
    {
      selector: 'node[entityType = "spec"]',
      style: { 'border-color': '#13C2C2' } as unknown as cytoscape.Css.Node,
    },
    {
      selector: 'node[entityType = "checkpoint"]',
      style: { 'border-color': 'data(color)', 'font-size': '9px' } as unknown as cytoscape.Css.Node,
    },
    {
      selector: 'node[entityType = "document"]',
      style: {
        'border-color': '#FA8C16',
        'border-style': 'dashed',
      } as unknown as cytoscape.Css.Node,
    },
    { selector: '.dimmed', style: { 'opacity': 0.1 } as unknown as cytoscape.Css.Node },
    {
      selector: '.focused',
      style: {
        'border-width': 4,
        'border-color': '#1677FF',
        'z-index': 100,
        'transition-property': 'border-color, border-width',
        'transition-duration': '0.6s',
        'transition-timing-function': 'ease-in-out',
      } as unknown as cytoscape.Css.Node,
    },
    {
      selector: '.focused.pulse',
      style: { 'border-width': 5, 'border-color': '#40A9FF' } as unknown as cytoscape.Css.Node,
    },
    {
      selector: 'edge',
      style: {
        'curve-style': 'unbundled-bezier',
        'control-point-distances': '60',
        'control-point-weights': '0.5',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8,
        'line-color': ec,
        'target-arrow-color': ec,
        'width': 1.5,
        'opacity': 0.5,
        'label': 'data(label)',
        'font-size': '9px',
        'font-weight': 600,
        'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        'color': isDark ? '#A0A0B0' : '#555',
        'text-background-color': isDark ? '#1D1D26' : '#FFF',
        'text-background-opacity': 1,
        'text-background-padding': '2px 6px',
        'text-background-shape': 'roundrectangle',
        'text-border-width': 1,
        'text-border-color': ec,
        'text-border-opacity': 0.5,
        'text-rotation': 0,
        'edge-distances': 'node-position',
      } as unknown as cytoscape.Css.Edge,
    },
    { selector: 'edge.dimmed', style: { 'opacity': 0.03 } as unknown as cytoscape.Css.Edge },
    {
      selector: 'edge.highlighted',
      style: {
        'opacity': 0.7,
        'width': 2,
        'line-color': '#1677FF',
        'target-arrow-color': '#1677FF',
      } as unknown as cytoscape.Css.Edge,
    },
  ];
}
