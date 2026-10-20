import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
  domainReadOnlyMessage,
  findDomainProjectHint,
  findDomainTaskHint,
} from '../src/provider/hints';
import { createTempLatticeHome } from './helpers';

const { knowledgeViewMock } = vi.hoisted(() => ({ knowledgeViewMock: vi.fn() }));

vi.mock('../src/provider/composite', () => ({
  createComposite: vi.fn(async () => ({ knowledgeView: knowledgeViewMock })),
}));

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
  knowledgeViewMock.mockReset();
});

afterEach(async () => {
  await env.cleanup();
});

test('findDomainTaskHint：域任务命中/local 排除/异常降级', async () => {
  knowledgeViewMock.mockResolvedValue({
    labels: new Map([['team12345678', '团队域']]),
    tasks: [
      { task: { id: 'local-task' }, source: 'local' },
      { task: { id: 'domain-task' }, source: 'team12345678' },
    ],
    projects: [],
  });
  assert.deepEqual(await findDomainTaskHint('t', 'domain-task'), {
    label: '团队域(team1234)',
    kind: 'task',
  });
  assert.equal(await findDomainTaskHint('t', 'local-task'), null);
  assert.equal(await findDomainTaskHint('t', 'missing'), null);

  knowledgeViewMock.mockRejectedValue(new Error('offline'));
  assert.equal(await findDomainTaskHint('t', 'domain-task'), null);
});

test('findDomainProjectHint：按 id/contractId 命中，local 排除', async () => {
  knowledgeViewMock.mockResolvedValue({
    labels: new Map(),
    tasks: [],
    projects: [
      { project: { id: 'p-local' }, contractId: 'c-local', source: 'local' },
      { project: { id: 'p-remote' }, contractId: 'c-remote', source: 'domain-abcdefgh' },
    ],
  });
  assert.deepEqual(await findDomainProjectHint('t', 'p-remote'), {
    label: '域 domain-a',
    kind: 'project',
  });
  assert.deepEqual(await findDomainProjectHint('t', 'c-remote'), {
    label: '域 domain-a',
    kind: 'project',
  });
  assert.equal(await findDomainProjectHint('t', 'p-local'), null);
  assert.equal(await findDomainProjectHint('t', 'nope'), null);

  knowledgeViewMock.mockRejectedValue(new Error('bad'));
  assert.equal(await findDomainProjectHint('t', 'p-remote'), null);
});

test('domainReadOnlyMessage：task/project/spec 文案', () => {
  assert.match(domainReadOnlyMessage({ label: '团队域(x)', kind: 'task' }), /未在本地找到该任务/);
  assert.match(
    domainReadOnlyMessage({ label: '团队域(x)', kind: 'project' }),
    /未在本地找到该项目/,
  );
  assert.match(domainReadOnlyMessage({ label: '团队域(x)', kind: 'spec' }), /未在本地找到该spec/);
  assert.match(domainReadOnlyMessage({ label: 'L', kind: 'spec' }), /域 L：域数据只读/);
});
