/**
 * 准备 Playwright E2E 的隔离数据根（packages/e2e/.tmp-e2e-home）。
 *
 * - 红线：与真实 ~/.lattice 零接触；每次运行整体重建（幂等）
 * - 硬离线：config.json 关闭 embedding 远程模型（搜索走本地降级路径，不拉模型）
 * - 数据面：2 个项目 + 1 个任务（PRD/progress）+ 用户级 spec + 项目关系
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const HOME = resolve(here, '../.tmp-e2e-home');
const U = 'e2e';
const NOW = '2026-10-19T00:00:00.000Z';

rmSync(HOME, { recursive: true, force: true });

function write(rel, content) {
  const p = join(HOME, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
}

const workspace = join(HOME, 'workspace');
mkdirSync(workspace, { recursive: true });

write('config/config-local.json', { username: U });
write('config/config.json', { rag: { embedding: { allowRemoteModels: false } } });

write(`users/${U}/projects/e2e-proj/project.json`, {
  id: 'e2e-proj',
  ids: ['e2e-proj'],
  name: 'E2E 演示项目',
  description: '浏览器 E2E 演示项目',
  localPaths: [workspace],
  gitRemotes: [],
  packageNames: ['e2e-demo'],
  created: NOW,
});

write(`users/${U}/projects/e2e-other/project.json`, {
  id: 'e2e-other',
  ids: ['e2e-other'],
  name: '其他项目',
  description: '用于过滤断言的非命中项目',
  localPaths: [],
  gitRemotes: [],
  packageNames: [],
  created: NOW,
});

write(`users/${U}/tasks/e2e-task-1/task.json`, {
  id: 'e2e-task-1',
  title: 'E2E 演示任务',
  status: 'in_progress',
  projects: ['e2e-proj'],
  scopePaths: [{ path: workspace, addedAt: NOW }],
  referencedSpecs: [],
  created: NOW,
  updated: NOW,
});
write(`users/${U}/tasks/e2e-task-1/prd.md`, '# E2E 演示任务\n\n这是浏览器 E2E 的演示 PRD 正文。\n');
write(
  `users/${U}/tasks/e2e-task-1/progress.yaml`,
  [
    'entries:',
    '  - id: cp-e2e-0001',
    `    time: "${NOW}"`,
    '    type: note',
    '    title: 演示检查点',
    '    message: e2e fixture',
    '',
  ].join('\n'),
);

write(
  `users/${U}/spec/e2e-spec.md`,
  '---\nid: spec-e2e0001\ntitle: E2E 用户规范\n---\n\n演示规范正文。\n',
);

write(`users/${U}/relations.json`, {
  version: 1,
  relations: [
    {
      id: 'rel-e2e-1',
      type: 'depends-on',
      projectA: 'e2e-proj',
      projectB: 'e2e-other',
      description: '演示关系',
      createdBy: 'manual',
      created: NOW,
    },
  ],
});

console.log(`✓ E2E fixture home prepared: ${HOME}`);
