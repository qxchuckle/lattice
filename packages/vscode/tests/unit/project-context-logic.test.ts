import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  buildCandidates,
  compareCandidates,
  deepestCandidateForPath,
  hasMultipleProjectCandidates,
  isPathInsideOrEqual,
  makeCandidate,
  projectDisplayName,
  resolveActiveCandidate,
  tasksProjectHeader,
  type FolderProjectInfo,
  type WorkspaceFolderInput,
} from '../../src/state/project-context-logic';

const root = '/repo';
const folderA: WorkspaceFolderInput = {
  uri: 'file:///repo',
  name: 'repo',
  fsPath: root,
};
const folderB: WorkspaceFolderInput = {
  uri: 'file:///other',
  name: 'other',
  fsPath: '/other',
};
const info = new Map<string, FolderProjectInfo>([
  [folderA.uri, { anchorRoot: root, gitRoot: root, declaredId: 'root-id' }],
  [folderB.uri, { anchorRoot: null, gitRoot: '/other', declaredId: null }],
]);

const registered = [
  { id: 'legacy:root', name: 'Root', localPaths: [root] },
  { id: 'legacy:a', name: 'Package A', localPaths: [`${root}/packages/a`] },
  { id: 'legacy:b', name: 'Package B', localPaths: [`${root}/packages/b`] },
  { id: 'legacy:other', name: 'Other', localPaths: ['/other'] },
  { id: 'legacy:outside', name: 'Outside', localPaths: ['/elsewhere'] },
];

test('路径包含按路径段判断，不让 /repo 命中 /repository', () => {
  assert.equal(isPathInsideOrEqual('/repo', '/repo/packages/a'), true);
  assert.equal(isPathInsideOrEqual('/repo', '/repo'), true);
  assert.equal(isPathInsideOrEqual('/repo', '/repository'), false);
});

test('候选构建：每个 folder 根 + folder 内注册项目，去重根项目', () => {
  const candidates = buildCandidates([folderA, folderB], info, registered);
  const a = candidates.filter((candidate) => candidate.folderUri === folderA.uri);
  assert.equal(a.length, 3);
  assert.ok(a.some((candidate) => candidate.isRoot));
  assert.ok(a.some((candidate) => candidate.projectId === 'legacy:a'));
  assert.ok(a.some((candidate) => candidate.projectId === 'legacy:b'));
  assert.equal(a.filter((candidate) => candidate.isRoot).length, 1);
  assert.equal(candidates.filter((candidate) => candidate.folderUri === folderB.uri).length, 1);
});

test('最深路径：/repo/packages/a/src 命中 a，而不是根项目', () => {
  const candidates = buildCandidates([folderA], info, registered);
  const picked = deepestCandidateForPath(candidates, `${root}/packages/a/src/index.ts`);
  assert.equal(picked?.projectId, 'legacy:a');
});

test('活动项目：未 pin 时跟随活动文件所属的最深项目', () => {
  const candidates = buildCandidates([folderA], info, registered);
  const picked = resolveActiveCandidate({
    candidates,
    folders: [folderA],
    activeFilePath: `${root}/packages/b/src/index.ts`,
  });
  assert.equal(picked?.projectId, 'legacy:b');
});

test('活动项目：pin 项目优先于活动文件', () => {
  const candidates = buildCandidates([folderA], info, registered);
  const pinned = candidates.find((candidate) => candidate.projectId === 'legacy:a');
  assert.ok(pinned);
  const picked = resolveActiveCandidate({
    candidates,
    folders: [folderA],
    activeFilePath: `${root}/packages/b/src/index.ts`,
    pinned: { folderUri: folderA.uri, rootPath: `${root}/packages/a` },
  });
  assert.equal(picked?.projectId, 'legacy:a');
});

test('活动项目：多根 folder 下 pin folder 作为无活动文件回退', () => {
  const candidates = buildCandidates([folderA, folderB], info, registered);
  const picked = resolveActiveCandidate({
    candidates,
    folders: [folderA, folderB],
    pinnedFolderUri: folderB.uri,
  });
  assert.equal(picked?.folderUri, folderB.uri);
  assert.equal(picked?.isRoot, true);
});

test('旧 pin folder 仍优先于活动文件（兼容旧语义）', () => {
  const candidates = buildCandidates([folderA, folderB], info, registered);
  const picked = resolveActiveCandidate({
    candidates,
    folders: [folderA, folderB],
    activeFilePath: `${root}/packages/a/src/index.ts`,
    pinnedFolderUri: folderB.uri,
  });
  assert.equal(picked?.folderUri, folderB.uri);
  assert.equal(picked?.isRoot, true);
});

test('folder 根在父级 Git 根时，根候选保留父项目根路径', () => {
  const nestedFolder: WorkspaceFolderInput = {
    uri: 'file:///repo/packages/a',
    name: 'a',
    fsPath: `${root}/packages/a`,
  };
  const nestedInfo = new Map<string, FolderProjectInfo>([
    [nestedFolder.uri, { anchorRoot: null, gitRoot: root, declaredId: null }],
  ]);
  const candidates = buildCandidates([nestedFolder], nestedInfo, registered);
  const rootCandidate = candidates.find((candidate) => candidate.isRoot);
  assert.equal(rootCandidate?.rootPath, root);
  assert.equal(rootCandidate?.folderUri, nestedFolder.uri);
});

test('嵌套未注册候选：动态锚点加入后按最深路径选中', () => {
  const candidates = buildCandidates([folderA], info, registered);
  const nested = makeCandidate({
    folder: folderA,
    rootPath: `${root}/packages/c`,
    anchorRoot: `${root}/packages/c`,
    gitRoot: root,
    source: 'anchor',
  });
  candidates.push(nested);
  const picked = resolveActiveCandidate({
    candidates,
    folders: [folderA],
    activeFilePath: `${root}/packages/c/src/index.ts`,
  });
  assert.equal(picked?.rootPath, `${root}/packages/c`);
  assert.equal(picked?.source, 'anchor');
});

test('排序：按 folder 顺序、根项目优先、再按路径', () => {
  const candidates = buildCandidates([folderA, folderB], info, registered);
  const sorted = [...candidates].sort((a, b) =>
    compareCandidates(a, b, [folderA.uri, folderB.uri]),
  );
  assert.equal(sorted[0].folderUri, folderA.uri);
  assert.equal(sorted[0].isRoot, true);
  assert.equal(sorted[sorted.length - 1].folderUri, folderB.uri);
});

test('项目短名：项目名 > 候选名 > 根目录名', () => {
  assert.equal(
    projectDisplayName({ projectName: 'Root', candidateName: 'Candidate', rootPath: '/repo/x' }),
    'Root',
  );
  assert.equal(
    projectDisplayName({ projectName: '  ', candidateName: 'Nested', rootPath: '/repo/x' }),
    'Nested',
  );
  assert.equal(projectDisplayName({ rootPath: '/repo/packages/a' }), 'a');
  assert.equal(projectDisplayName({}), undefined);
});

test('多项目判定：无候选 / 单个 folder 项目 → false', () => {
  assert.equal(hasMultipleProjectCandidates([]), false);
  const single = buildCandidates([folderA], info, [
    { id: 'legacy:root', name: 'Root', localPaths: [root] },
  ]);
  // folder 根 + 同根已注册候选是同一个项目（根目录对齐），不能算两个
  assert.equal(hasMultipleProjectCandidates(single), false);
});

test('多项目判定：根项目 + 已注册子项目 → true', () => {
  const candidates = buildCandidates([folderA], info, [
    { id: 'legacy:root', name: 'Root', localPaths: [root] },
    { id: 'legacy:a', name: 'Package A', localPaths: [`${root}/packages/a`] },
  ]);
  assert.equal(hasMultipleProjectCandidates(candidates), true);
});

test('多项目判定：未注册嵌套锚点 + 根锚点 → true', () => {
  const candidates = buildCandidates([folderA], info, []);
  candidates.push(
    makeCandidate({
      folder: folderA,
      rootPath: `${root}/packages/c`,
      anchorRoot: `${root}/packages/c`,
      gitRoot: root,
      source: 'anchor',
    }),
  );
  assert.equal(hasMultipleProjectCandidates(candidates), true);
});

test('多项目判定：无锚点 folder + 仅嵌套已注册项目 → false', () => {
  const bare: WorkspaceFolderInput = { uri: 'file:///plain', name: 'plain', fsPath: '/plain' };
  const bareInfo = new Map<string, FolderProjectInfo>([
    [bare.uri, { anchorRoot: null, gitRoot: '/plain', declaredId: null }],
  ]);
  const candidates = buildCandidates([bare], bareInfo, [
    { id: 'legacy:n', name: 'Nested', localPaths: ['/plain/pkg'] },
  ]);
  assert.equal(hasMultipleProjectCandidates(candidates), false);
});

test('面板顶部当前项目条目：仅当前项目范围产出', () => {
  assert.equal(
    tasksProjectHeader({ scope: 'all', projectId: 'legacy:a', projectName: 'A' }),
    undefined,
  );
  assert.equal(tasksProjectHeader({ scope: 'project' }), undefined);
  assert.deepEqual(
    tasksProjectHeader({
      scope: 'project',
      projectId: 'legacy:a',
      projectName: 'Package A',
      canSwitch: true,
    }),
    { name: 'Package A', projectId: 'legacy:a', unregistered: false, canSwitch: true },
  );
});

test('面板顶部当前项目条目：未注册锚点用目录名并标记未注册', () => {
  assert.deepEqual(tasksProjectHeader({ scope: 'project', rootPath: '/repo/packages/c' }), {
    name: 'c',
    projectId: undefined,
    unregistered: true,
    canSwitch: false,
  });
});
