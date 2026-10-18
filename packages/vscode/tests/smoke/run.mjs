/**
 * Webview 冒烟 harness 运行器：Node + jsdom 中启动真实应用壳（见 webview/src/smoke/entry.tsx），
 * 数据来自真实 ltc CLI（LATTICE_HOME 可覆盖）；覆盖：初始渲染 + 图谱数据管线 +
 * 项目/任务/Spec 详情 + 全局搜索 + 侧栏筛选视图。
 *
 * 用法：pnpm --filter lattice run test:smoke （先 vite build smoke 产物）
 */
// 冒烟统一走 FTS 路径：禁用本地语义模型（跳过 transformers/onnxruntime 加载；
// 同时规避 onnxruntime-node 在 macOS 进程退出时的上游 teardown 崩溃）。
process.env.LATTICE_DISABLE_SEMANTIC = '1';

import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const bundlePath = resolve(import.meta.dirname, '../../.vscode-test/smoke-bundle/entry.js');

const failures = [];
const capturedErrors = [];
const fail = (message) => {
  failures.push(message);
  console.error(`  ✗ ${message}`);
};
const ok = (message) => console.log(`  ✓ ${message}`);

// ── jsdom 环境（必须在 import bundle 之前装好）──
const dom = new JSDOM(
  '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
  { url: 'http://localhost/', pretendToBeVisual: true },
);
const { window } = dom;

const globalsFromWindow = [
  'window',
  'document',
  'self',
  'navigator',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'SVGElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'DOMRect',
  'Image',
];
for (const key of globalsFromWindow) {
  try {
    Object.defineProperty(globalThis, key, {
      value: window[key],
      configurable: true,
      writable: true,
    });
  } catch {
    /* ignore readonly globals */
  }
}

window.matchMedia =
  window.matchMedia ||
  ((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  }));
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;
window.IntersectionObserver = window.IntersectionObserver || IntersectionObserverStub;
window.scrollTo = window.scrollTo || (() => {});
for (const key of ['matchMedia', 'ResizeObserver', 'IntersectionObserver']) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true });
}

// ── 错误捕获（静默收集；失败时统一打印）──
console.error = (...args) => {
  capturedErrors.push(args.map((arg) => String(arg)).join(' '));
};
process.on('unhandledRejection', (error) => {
  capturedErrors.push(`unhandledRejection: ${String(error)}`);
  failures.push(`unhandledRejection: ${String(error)}`);
});
window.addEventListener('error', (event) => {
  capturedErrors.push(`window.error: ${event.message}`);
});

// ── 工具 ──
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
async function waitFor(label, predicate, timeoutMs = 60_000, intervalMs = 100) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  fail(`等待超时：${label}`);
  return false;
}
const idle = () => window.__smoke?.queryClient.isFetching() === 0;
const bodyText = () => window.document.body.textContent || '';
const assertNoErrorBoundary = (label) => {
  if (/页面出错了|Something went wrong/.test(bodyText())) {
    fail(`${label}：ErrorBoundary 渲染了错误页`);
    return false;
  }
  return true;
};

// ── 启动 ──
console.log(`▶ smoke bundle: ${bundlePath}`);
await import(pathToFileURL(bundlePath).href);
const smoke = window.__smoke;
if (!smoke) {
  console.error('bundle 未暴露 window.__smoke（启动即失败）');
  for (const line of capturedErrors.slice(-10)) console.error(`  [console.error] ${line}`);
  process.exit(1);
}

console.log('\n[1] 初始渲染 + 全局图谱数据管线');
await waitFor('初始查询 idle', idle, 150_000);
await sleep(200);
assertNoErrorBoundary('初始渲染');
ok('初始渲染无错误页');

const [projects, tasks, specGroups] = await Promise.all([
  smoke.getProjects(),
  smoke.getTasks(),
  smoke.getSpecs(),
]);
const specs = [
  ...(specGroups.project || []),
  ...(specGroups.user || []),
  ...(specGroups.global || []),
];
const dataCount = projects.length + tasks.length + specs.length;
console.log(`  数据规模：projects=${projects.length} tasks=${tasks.length} specs=${specs.length}`);

await waitFor(
  '图谱数据管线产出节点',
  () => {
    const graph = window.__smokeGraph;
    return !!graph && (graph.nodes.length > 0 || graph.isLoading === false);
  },
  60_000,
);
const graph = window.__smokeGraph;
if (!graph) {
  fail('useGlobalGraph 未产出数据（window.__smokeGraph 缺失）');
} else {
  console.log(`  图谱：nodes=${graph.nodes.length} edges=${graph.edges.length}`);
  if (dataCount > 0 && graph.nodes.length === 0) {
    fail('真实数据非空但图谱节点为 0（buildIdMap / 数据映射异常）');
  } else {
    ok('useGlobalGraph 数据管线渲染通过');
  }
}
const graphNodes = graph?.nodes || [];
const findNode = (entityType) =>
  graphNodes.find((node) => node.data && node.data.entityType === entityType);

console.log('\n[2] 项目详情面板');
if (projects.length === 0) {
  console.log('  （无项目数据，跳过）');
} else {
  const projectNode = findNode('project');
  const project = projects[0];
  smoke.driveSelect(projectNode?.id ?? project.id, 'project', projectNode?.data);
  await Promise.all([
    waitFor('项目详情加载', idle, 90_000),
    waitFor(`项目详情渲染「${project.name}」`, () => bodyText().includes(project.name), 30_000),
  ]);
  if (assertNoErrorBoundary('项目详情')) ok('项目详情渲染通过');
  smoke.closeDetail();
}

console.log('\n[3] 任务详情面板（含 progress / 树 / 血缘）');
if (tasks.length === 0) {
  console.log('  （无任务数据，跳过）');
} else {
  const task = tasks.find((item) => item.status === 'in_progress') || tasks[0];
  const taskNode = graphNodes.find(
    (node) => node.data?.entityType === 'task' && node.data?.taskId === task.id,
  );
  smoke.driveSelect(taskNode?.id ?? task.id, 'task', taskNode?.data);
  await waitFor('任务详情加载', idle, 120_000);
  await waitFor(
    `任务详情渲染「${task.title.slice(0, 10)}」`,
    () => bodyText().includes(task.title.slice(0, 10)),
    30_000,
  );
  if (assertNoErrorBoundary('任务详情')) ok('任务详情渲染通过');
  smoke.closeDetail();
}

console.log('\n[4] Spec 详情面板（含内容回退读取）');
if (specs.length === 0) {
  console.log('  （无 spec 数据，跳过）');
} else {
  const specNode = findNode('spec');
  if (!specNode) {
    console.log('  （图谱中无 spec 节点，跳过）');
  } else {
    smoke.driveSelect(specNode.id, 'spec', specNode.data);
    await waitFor('Spec 详情加载', idle, 90_000);
    const title = String(specNode.data?.title || '');
    if (title) {
      await waitFor(
        `Spec 详情渲染「${title.slice(0, 8)}」`,
        () => bodyText().includes(title.slice(0, 8)),
        30_000,
      );
    }
    if (assertNoErrorBoundary('Spec 详情')) ok('Spec 详情渲染通过');
    smoke.closeDetail();
  }
}

console.log('\n[5] 全局搜索面板');
smoke.stores.globalSearchStore.open = true;
await sleep(500);
const searchInput = [...window.document.querySelectorAll('input')].find((element) =>
  String(element.getAttribute('placeholder') || '').includes('搜索'),
);
if (!searchInput) {
  fail('全局搜索面板输入框未找到');
} else {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  valueSetter?.call(searchInput, projects[0]?.name?.slice(0, 4) || 'lattice');
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor('搜索查询 idle', idle, 90_000);
  await sleep(300);
  if (assertNoErrorBoundary('全局搜索')) ok('全局搜索面板渲染通过');
}
smoke.stores.globalSearchStore.open = false;

console.log('\n[6] 侧栏筛选视图');
smoke.stores.sidebarStore.activeView = 'filter';
await sleep(400);
if (assertNoErrorBoundary('侧栏筛选')) ok('侧栏筛选视图渲染通过');
smoke.stores.sidebarStore.activeView = 'tree';

console.log('\n[7] 项目 Git 状态桥');
const gitProbe = projects.find((p) => (p.localPaths || []).length > 0) || projects[0];
if (gitProbe) {
  try {
    const status = await window.__smoke.adapter.getProjectGitStatus(gitProbe.id);
    if (status !== null && typeof status.branch !== 'string') {
      fail('getProjectGitStatus 结果形状异常（branch 非字符串）');
    } else {
      console.log(
        `  ✓ getProjectGitStatus（${gitProbe.name}）：${status ? `branch=${status.branch} dirty=${status.dirty}` : 'null（非 git 项目）'}`,
      );
    }
  } catch (error) {
    fail(`getProjectGitStatus 抛错: ${String(error)}`);
  }
} else {
  console.log('  （无项目数据，跳过）');
}

console.log('\n[8] 侧栏详情视图（点哪看哪）');
try {
  // 空态
  await window.__smoke.renderDetail();
  await new Promise((resolve) => setTimeout(resolve, 300));
  if ((window.document.body.textContent ?? '').includes('暂无详情目标')) {
    console.log('  ✓ 空态提示渲染');
  } else {
    fail('详情视图空态未渲染');
  }

  // 任务（真实数据首条任务）
  const detailTasks = await window.__smoke.getTasks();
  const detailTask =
    (detailTasks ?? []).find((item) => item && item.title) ?? (detailTasks ?? [])[0];
  if (detailTask) {
    await window.__smoke.renderDetail(`/task/${encodeURIComponent(detailTask.id)}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const text = window.document.body.textContent ?? '';
    if (text.includes(detailTask.title)) {
      console.log(`  ✓ 任务详情渲染（${detailTask.title}）`);
    } else {
      fail(`任务详情未渲染标题：${detailTask.title}`);
    }
  } else {
    console.log('  （无任务数据，跳过任务断言）');
  }

  // 规范
  const detailSpecs = await window.__smoke.getSpecs();
  const detailSpec = [
    ...(detailSpecs?.project ?? []),
    ...(detailSpecs?.user ?? []),
    ...(detailSpecs?.global ?? []),
  ].find((spec) => spec && (spec.title || spec.id));
  if (detailSpec) {
    await window.__smoke.renderDetail(`/spec/${encodeURIComponent(detailSpec.id)}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const text = window.document.body.textContent ?? '';
    if (!detailSpec.title || text.includes(detailSpec.title)) {
      console.log(`  ✓ 规范详情渲染（${detailSpec.title || detailSpec.id}）`);
    } else {
      fail(`规范详情未渲染标题：${detailSpec.title}`);
    }
  } else {
    console.log('  （无规范数据，跳过规范断言）');
  }

  // 项目
  const detailProjects = await window.__smoke.getProjects();
  const detailProject = (detailProjects ?? []).find(
    (project) => project && (project.name || project.id),
  );
  if (detailProject) {
    await window.__smoke.renderDetail(`/project/${encodeURIComponent(detailProject.id)}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const text = window.document.body.textContent ?? '';
    if (text.includes(detailProject.name || detailProject.id)) {
      console.log(`  ✓ 项目详情渲染（${detailProject.name || detailProject.id}）`);
    } else {
      fail('项目详情未渲染项目名');
    }
  } else {
    console.log('  （无项目数据，跳过项目断言）');
  }
} catch (error) {
  fail(`详情视图渲染抛错: ${String(error)}`);
}

// ── 汇总 ──
console.log('');

// 显式关停数据面（better-sqlite3 关闭），并留出收尾时间——否则终结器与 process.exit 竞争会触发原生 abort
try {
  window.__smoke.shutdown?.();
} catch {
  /* ignore */
}
await new Promise((resolve) => setTimeout(resolve, 200));
if (failures.length > 0) {
  console.error(`SMOKE FAILED：${failures.length} 项失败`);
  for (const failure of failures) console.error(`  - ${failure}`);
  const relevant = capturedErrors.filter((line) =>
    /TypeError|ReferenceError|Cannot read|undefined \(reading|ErrorBoundary|页面出错/.test(line),
  );
  if (relevant.length > 0) {
    console.error('  运行期错误（节选）：');
    for (const line of relevant.slice(0, 10)) console.error(`  [err] ${line.slice(0, 500)}`);
  }
  process.exit(1);
} else {
  console.log('SMOKE PASSED：全部场景渲染通过');
  process.exit(0);
}
