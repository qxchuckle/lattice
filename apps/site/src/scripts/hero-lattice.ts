import type { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  ARTIFACTS,
  PROJECTS,
  PULSE_PATHS,
  RELATIONS,
  SESSIONS,
  type Artifact,
  type ArtifactKind,
  type Relation,
} from '../data/hero-lattice';

const COLS = 12;
const ROWS = 8;
const CELL_X = 48;
const CELL_Y = 66;
const SKEW_X = 28;

const KIND_COLOR: Record<ArtifactKind, number> = {
  spec: 0x58a6ff,
  task: 0x67e8f9,
  decision: 0xf0b429,
  checkpoint: 0x9fb3c8,
};

const KIND_LABEL: Record<ArtifactKind, string> = {
  spec: 'SPEC',
  task: 'TASK',
  decision: 'DECISION',
  checkpoint: 'CHECKPOINT',
};

const KIND_HEX: Record<ArtifactKind, string> = {
  spec: '#58a6ff',
  task: '#67e8f9',
  decision: '#f0b429',
  checkpoint: '#9fb3c8',
};

interface Point {
  x: number;
  y: number;
}

interface NodeView {
  artifact: Artifact;
  container: Container;
  shape: Graphics;
  glow: Sprite;
  edges: EdgeView[];
}

interface EdgeView {
  graphics: Graphics;
  a: NodeView;
  b: NodeView;
  baseAlpha: number;
  relation?: Relation;
}

interface PulseTimeline {
  pause(): void;
  resume(): void;
  kill(): void;
}

interface PulseView {
  container: Container;
  label: Text;
  trail: Graphics;
  path: NodeView[];
  timeline: PulseTimeline;
  lastIndex: number;
}

export interface HeroScene {
  setPaused(paused: boolean): void;
  isPaused(): boolean;
  destroy(): void;
}

export interface HeroSceneOptions {
  gsap: typeof import('gsap').gsap;
  reducedMotion: boolean;
}

function projectPoint(col: number, row: number, z = 0): Point {
  const cx = (COLS - 1) / 2;
  const cy = (ROWS - 1) / 2;
  return {
    x: (col - cx) * CELL_X + (row - cy) * SKEW_X,
    y: (row - cy) * CELL_Y - z,
  };
}

function createGlowTexture(TextureCtor: typeof import('pixi.js').Texture): Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return TextureCtor.WHITE;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.42)');
  gradient.addColorStop(0.52, 'rgba(255,255,255,0.1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return TextureCtor.from(canvas);
}

export async function initHeroLattice(
  stage: HTMLElement,
  options: HeroSceneOptions,
): Promise<HeroScene> {
  const { gsap, reducedMotion } = options;
  const PIXI = await import('pixi.js');
  const { Application, Container, Graphics, Sprite, Text, Texture, Rectangle } = PIXI;

  const app = new Application();
  await app.init({
    width: Math.max(stage.clientWidth, 1),
    height: Math.max(stage.clientHeight, 1),
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    powerPreference: 'high-performance',
  });
  app.canvas.setAttribute('aria-hidden', 'true');
  stage.appendChild(app.canvas);
  const showCanvasLabels = stage.clientWidth >= 520;

  const world = new Container();
  const gridLayer = new Graphics();
  const edgeLayer = new Container();
  const nodeLayer = new Container();
  const labelLayer = new Container();
  const pulseLayer = new Container();
  world.addChild(gridLayer, edgeLayer, nodeLayer, labelLayer, pulseLayer);
  app.stage.addChild(world);

  const glowTexture = createGlowTexture(Texture);
  const nodes = new Map<string, NodeView>();
  const edges: EdgeView[] = [];
  const pulses: PulseView[] = [];
  let paused = false;
  let inView = true;
  let destroyed = false;
  let pointerTarget = { x: 0, y: 0 };
  const pointerCurrent = { x: 0, y: 0 };
  let baseX = 0;
  let baseY = 0;
  let elapsed = 0;

  const nodeCard = document.getElementById('node-card');
  const cardKind = document.getElementById('node-card-kind');
  const cardTitle = document.getElementById('node-card-title');
  const cardMeta = document.getElementById('node-card-meta');
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  let hovered: NodeView | null = null;

  function drawGrid(): void {
    gridLayer.clear();

    for (let row = 0; row < ROWS; row += 1) {
      const a = projectPoint(0, row);
      const b = projectPoint(COLS - 1, row);
      gridLayer.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    for (let col = 0; col < COLS; col += 1) {
      const a = projectPoint(col, 0);
      const b = projectPoint(col, ROWS - 1);
      gridLayer.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    gridLayer.stroke({ width: 1, color: 0x7d9bc8, alpha: 0.08 });

    for (const project of PROJECTS) {
      const a = projectPoint(0, project.row);
      const b = projectPoint(COLS - 1, project.row);
      gridLayer.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    gridLayer.stroke({ width: 1, color: 0x58a6ff, alpha: 0.24 });

    for (const session of SESSIONS) {
      const a = projectPoint(session.col, 0);
      const b = projectPoint(session.col, ROWS - 1);
      gridLayer.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    gridLayer.stroke({ width: 1, color: 0x67e8f9, alpha: 0.13 });

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const p = projectPoint(col, row);
        gridLayer.circle(p.x, p.y, 0.7);
      }
    }
    gridLayer.fill({ color: 0x9fb3c8, alpha: 0.2 });

    if (showCanvasLabels) {
      for (const project of PROJECTS) {
        const p = projectPoint(-0.05, project.row);
        const label = new Text({
          text: project.label,
          style: {
            fontFamily: 'Geist Mono Variable',
            fontSize: 10.5,
            fill: 0x8b9bb0,
            letterSpacing: 0.8,
          },
        });
        label.anchor.set(1, 0.5);
        label.position.set(p.x, p.y);
        label.alpha = 0.65;
        labelLayer.addChild(label);
      }

      for (const session of SESSIONS) {
        const p = projectPoint(session.col, -0.55);
        const label = new Text({
          text: session.label,
          style: {
            fontFamily: 'Geist Mono Variable',
            fontSize: 9.5,
            fill: 0x8b9bb0,
            letterSpacing: 0.6,
          },
        });
        label.anchor.set(0.5, 1);
        label.position.set(p.x, p.y);
        label.alpha = 0.32;
        labelLayer.addChild(label);
      }
    }
  }

  function drawEdges(): void {
    for (const project of PROJECTS) {
      const rowNodes = [...nodes.values()]
        .filter((node) => node.artifact.project === project.id)
        .sort((a, b) => a.artifact.col - b.artifact.col);

      for (let i = 0; i < rowNodes.length - 1; i += 1) {
        const a = rowNodes[i];
        const b = rowNodes[i + 1];
        const pa = nodePoint(a);
        const pb = nodePoint(b);
        const graphics = new Graphics()
          .moveTo(pa.x, pa.y)
          .lineTo(pb.x, pb.y)
          .stroke({ width: 1, color: 0x58a6ff, alpha: 0.12 });
        edgeLayer.addChild(graphics);
        const edge: EdgeView = { graphics, a, b, baseAlpha: 0.12 };
        edges.push(edge);
        a.edges.push(edge);
        b.edges.push(edge);
      }
    }

    for (const relation of RELATIONS) {
      const a = nodes.get(relation.a);
      const b = nodes.get(relation.b);
      if (!a || !b) continue;
      const pa = nodePoint(a);
      const pb = nodePoint(b);
      const midX = (pa.x + pb.x) / 2;
      const midY = (pa.y + pb.y) / 2 - 26;
      const graphics = new Graphics()
        .moveTo(pa.x, pa.y)
        .quadraticCurveTo(midX, midY, pb.x, pb.y)
        .stroke({ width: 1, color: 0xf0b429, alpha: 0.14 });
      edgeLayer.addChild(graphics);
      const edge: EdgeView = { graphics, a, b, baseAlpha: 0.14, relation };
      edges.push(edge);
      a.edges.push(edge);
      b.edges.push(edge);
    }
  }

  function nodePoint(node: NodeView): Point {
    return projectPoint(node.artifact.col, node.artifact.row, node.artifact.z || 0);
  }

  function createNode(artifact: Artifact): NodeView {
    const p = projectPoint(artifact.col, artifact.row, artifact.z || 0);
    const color = KIND_COLOR[artifact.kind];
    const container = new Container();
    container.position.set(p.x, p.y);
    container.eventMode = 'none';

    const glow = new Sprite(glowTexture);
    glow.anchor.set(0.5);
    glow.tint = color;
    glow.alpha = artifact.kind === 'decision' ? 0.15 : 0.09;
    glow.scale.set(artifact.kind === 'decision' ? 1.9 : 1.5);
    glow.blendMode = 'add';
    container.addChild(glow);

    const shape = new Graphics();
    if (artifact.kind === 'spec') {
      shape.poly([0, -8.5, 8.5, 0, 0, 8.5, -8.5, 0]).fill({ color, alpha: 0.92 });
    } else if (artifact.kind === 'task') {
      shape.circle(0, 0, 6.4).stroke({ width: 1.6, color, alpha: 0.95 });
      shape.circle(0, 0, 1.5).fill({ color, alpha: 0.75 });
    } else if (artifact.kind === 'decision') {
      shape.poly([0, -9, 8, 6.2, -8, 6.2]).fill({ color, alpha: 0.92 });
    } else {
      shape.circle(0, 0, 2.6).fill({ color, alpha: 0.95 });
      shape.circle(0, 0, 5.8).stroke({ width: 1, color, alpha: 0.4 });
    }
    container.addChild(shape);

    nodeLayer.addChild(container);
    return { artifact, container, shape, glow, edges: [] };
  }

  function layout(): void {
    const width = app.renderer.width / app.renderer.resolution;
    const height = app.renderer.height / app.renderer.resolution;
    const scale = Math.min(width / 720, height / 530, 1.08);
    world.scale.set(scale);
    baseX = width / 2 + (stage.clientWidth >= 520 ? 34 : 0);
    baseY = height / 2 + 10;
    world.position.set(baseX, baseY);
  }

  function positionCard(node: NodeView): void {
    if (!nodeCard || !cardKind || !cardTitle || !cardMeta) return;
    const canvasRect = app.canvas.getBoundingClientRect();
    const visual = stage.parentElement;
    if (!visual) return;
    const visualRect = visual.getBoundingClientRect();
    const global = node.container.getGlobalPosition();
    const cardWidth = 236;
    const cardHeight = 150;
    let x = canvasRect.left - visualRect.left + global.x + 18;
    let y = canvasRect.top - visualRect.top + global.y - 36;
    x = Math.min(Math.max(x, 12), Math.max(visualRect.width - cardWidth - 12, 12));
    y = Math.min(Math.max(y, 12), Math.max(visualRect.height - cardHeight - 12, 12));
    nodeCard.style.left = `${x}px`;
    nodeCard.style.top = `${y}px`;
  }

  function setHovered(node: NodeView | null): void {
    if (node === hovered) return;
    if (hovered) {
      gsap.to(hovered.container.scale, {
        x: 1,
        y: 1,
        duration: 0.18,
        ease: 'power2.out',
        overwrite: true,
      });
      gsap.to(hovered.glow, {
        alpha: hovered.artifact.kind === 'decision' ? 0.15 : 0.09,
        duration: 0.18,
      });
      hovered.edges.forEach((edge) =>
        gsap.to(edge.graphics, { alpha: edge.baseAlpha, duration: 0.18, overwrite: true }),
      );
    }

    hovered = node;
    if (!node) {
      if (nodeCard) nodeCard.hidden = true;
      return;
    }

    gsap.to(node.container.scale, {
      x: 1.62,
      y: 1.62,
      duration: 0.22,
      ease: 'back.out(2)',
      overwrite: true,
    });
    gsap.to(node.glow, { alpha: 0.48, duration: 0.22, overwrite: true });
    node.edges.forEach((edge) =>
      gsap.to(edge.graphics, { alpha: 0.85, duration: 0.2, overwrite: true }),
    );

    if (nodeCard && cardKind && cardTitle && cardMeta) {
      cardKind.textContent = KIND_LABEL[node.artifact.kind];
      cardKind.style.color = KIND_HEX[node.artifact.kind];
      cardTitle.textContent = node.artifact.title;
      cardMeta.textContent = `${node.artifact.project} · ~/.lattice`;
      nodeCard.hidden = false;
      positionCard(node);
    }
  }

  function flashNode(node: NodeView): void {
    gsap.killTweensOf(node.container.scale);
    gsap.killTweensOf(node.glow);
    gsap.fromTo(
      node.container.scale,
      { x: 1, y: 1 },
      {
        x: 1.34,
        y: 1.34,
        duration: 0.2,
        yoyo: true,
        repeat: 1,
        ease: 'power2.out',
      },
    );
    gsap.fromTo(
      node.glow,
      { alpha: node.glow.alpha },
      {
        alpha: 0.48,
        duration: 0.2,
        yoyo: true,
        repeat: 1,
        ease: 'power2.out',
      },
    );
  }

  function pulseLabelPosition(node: NodeView): Point {
    const p = nodePoint(node);
    return { x: p.x, y: p.y - 15 };
  }

  function showPulseLabel(pulse: PulseView, node: NodeView): void {
    if (!showCanvasLabels) return;
    const p = pulseLabelPosition(node);
    pulse.label.text = node.artifact.label;
    pulse.label.position.set(p.x, p.y);
    pulse.label.alpha = 0;
    gsap.killTweensOf(pulse.label);
    gsap.fromTo(
      pulse.label,
      { alpha: 0, y: p.y + 5 },
      {
        alpha: 0.92,
        y: p.y - 3,
        duration: 0.24,
        ease: 'power2.out',
        onComplete: () => {
          gsap.to(pulse.label, {
            alpha: 0,
            y: p.y - 12,
            duration: 0.45,
            delay: 0.7,
            ease: 'power1.in',
          });
        },
      },
    );
  }

  function drawTrail(pulse: PulseView, from: NodeView, to: NodeView): void {
    const a = nodePoint(from);
    const b = nodePoint(to);
    pulse.trail.clear();
    pulse.trail
      .moveTo(a.x, a.y)
      .lineTo(b.x, b.y)
      .stroke({ width: 1, color: 0x9cc7ff, alpha: 0.38 });
    gsap.killTweensOf(pulse.trail);
    pulse.trail.alpha = 0.6;
    gsap.to(pulse.trail, { alpha: 0, duration: 1.1, ease: 'power1.out' });
  }

  function triggerPulseNode(pulse: PulseView, index: number): void {
    const node = pulse.path[index];
    if (!node) return;
    flashNode(node);
    showPulseLabel(pulse, node);
    if (index > 0) drawTrail(pulse, pulse.path[index - 1], node);
  }

  function createPulse(path: NodeView[], index: number): PulseView {
    const container = new Container();
    const trail = new Graphics();
    const glow = new Sprite(glowTexture);
    glow.anchor.set(0.5);
    glow.tint = 0x9cc7ff;
    glow.alpha = 0.42;
    glow.scale.set(1.5);
    glow.blendMode = 'add';
    const core = new Graphics().circle(0, 0, 2.1).fill({ color: 0xeaf4ff, alpha: 1 });
    container.addChild(glow, core);
    const first = nodePoint(path[0]);
    container.position.set(first.x, first.y);
    container.alpha = 0;
    pulseLayer.addChild(trail, container);

    const label = new Text({
      text: '',
      style: {
        fontFamily: 'Geist Mono Variable',
        fontSize: 11,
        fill: 0xdbeafe,
        letterSpacing: 0.2,
      },
    });
    label.anchor.set(0.5, 1);
    label.alpha = 0;
    pulseLayer.addChild(label);

    const state = { t: 0 };
    const timeline = gsap.timeline({
      repeat: -1,
      repeatDelay: 1.5,
      delay: 1.2 + index * 2.35,
      onRepeat: () => {
        state.t = 0;
        pulse.lastIndex = -1;
        pulse.container.alpha = 0;
        trail.clear();
      },
    });

    const pulse: PulseView = {
      container,
      label,
      trail,
      path,
      timeline,
      lastIndex: -1,
    };

    timeline.to(state, {
      t: path.length - 1,
      duration: (path.length - 1) * 0.92,
      ease: 'none',
      onUpdate: () => {
        const raw = state.t;
        const i = Math.min(Math.floor(raw), path.length - 2);
        const frac = raw - i;
        const a = nodePoint(pulse.path[i]);
        const b = nodePoint(pulse.path[i + 1]);
        pulse.container.alpha = 1;
        pulse.container.position.set(a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac);
        const indexAt = Math.min(Math.round(raw), path.length - 1);
        if (indexAt !== pulse.lastIndex) {
          pulse.lastIndex = indexAt;
          triggerPulseNode(pulse, indexAt);
        }
      },
    });

    return pulse;
  }

  drawGrid();
  for (const artifact of ARTIFACTS) {
    const node = createNode(artifact);
    nodes.set(artifact.id, node);
  }
  drawEdges();

  if (!reducedMotion) {
    PULSE_PATHS.forEach((ids, index) => {
      const path = ids.map((id) => nodes.get(id)).filter((node): node is NodeView => Boolean(node));
      if (path.length < 2) return;
      pulses.push(createPulse(path, index));
    });

    gsap.fromTo(world, { alpha: 0 }, { alpha: 1, duration: 1.15, ease: 'power3.out' });
    [...nodes.values()].forEach((node, index) => {
      const base = node.container.scale.x;
      gsap.fromTo(
        node.container.scale,
        { x: base * 0.4, y: base * 0.4 },
        {
          x: base,
          y: base,
          duration: 0.55,
          delay: 0.35 + index * 0.028,
          ease: 'back.out(2)',
        },
      );
      gsap.fromTo(
        node.container,
        { alpha: 0 },
        { alpha: 1, duration: 0.4, delay: 0.35 + index * 0.028, ease: 'power1.out' },
      );
    });
  }

  layout();

  const resizeObserver = new ResizeObserver(() => {
    if (destroyed) return;
    const width = Math.max(stage.clientWidth, 1);
    const height = Math.max(stage.clientHeight, 1);
    app.renderer.resize(width, height);
    layout();
    app.stage.hitArea = new Rectangle(0, 0, width, height);
    if (paused || reducedMotion) app.renderer.render(app.stage);
  });
  resizeObserver.observe(stage);

  if (finePointer && !reducedMotion) {
    app.stage.eventMode = 'static';
    app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);
    app.stage.on('pointermove', (event: any) => {
      if (paused) return;
      const point = event.global;
      let best: NodeView | null = null;
      let bestDistance = 34;
      for (const node of nodes.values()) {
        const global = node.container.getGlobalPosition();
        const distance = Math.hypot(global.x - point.x, global.y - point.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = node;
        }
      }
      setHovered(best);
      const rect = app.canvas.getBoundingClientRect();
      const nx = ((point.x - rect.left) / Math.max(rect.width, 1) - 0.5) * 2;
      const ny = ((point.y - rect.top) / Math.max(rect.height, 1) - 0.5) * 2;
      pointerTarget = { x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) };
    });
    app.stage.on('pointerleave', () => {
      setHovered(null);
      pointerTarget = { x: 0, y: 0 };
    });
  }

  app.ticker.add((ticker) => {
    if (paused || reducedMotion) return;
    elapsed += ticker.deltaMS;
    pointerCurrent.x += (pointerTarget.x - pointerCurrent.x) * 0.035;
    pointerCurrent.y += (pointerTarget.y - pointerCurrent.y) * 0.035;
    world.x = baseX + pointerCurrent.x * 7 + Math.sin(elapsed * 0.00018) * 2.2;
    world.y = baseY + pointerCurrent.y * 5 + Math.cos(elapsed * 0.00015) * 1.6;
    gridLayer.alpha = 0.88 + Math.sin(elapsed * 0.0007) * 0.08;
  });

  function syncPlayback(): void {
    if (reducedMotion) return;
    const shouldRun = !paused && inView && !document.hidden;
    if (shouldRun) {
      app.ticker.start();
      pulses.forEach((pulse) => pulse.timeline.resume());
    } else {
      app.ticker.stop();
      pulses.forEach((pulse) => pulse.timeline.pause());
    }
  }

  function setPaused(next: boolean): void {
    if (reducedMotion) return;
    paused = next;
    syncPlayback();
  }

  const intersectionObserver = new IntersectionObserver((entries) => {
    inView = entries[0]?.isIntersecting ?? true;
    syncPlayback();
  });
  intersectionObserver.observe(stage);

  const onVisibilityChange = (): void => syncPlayback();
  document.addEventListener('visibilitychange', onVisibilityChange);

  function destroy(): void {
    destroyed = true;
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    pulses.forEach((pulse) => pulse.timeline.kill());
    gsap.killTweensOf(world);
    app.destroy(true, { children: true, texture: true, textureSource: true });
  }

  if (reducedMotion) {
    app.ticker.stop();
    app.renderer.render(app.stage);
  }

  return {
    setPaused,
    isPaused: () => paused,
    destroy,
  };
}
