import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openDirectory, openLatticeRoot, openWithEditor } from '../src/maintenance/open';
import { createTempLatticeHome } from './helpers';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock('node:child_process', () => ({ execFile: execFileMock }));

/** 与 src/maintenance/open.ts 的平台映射保持一致（CI 跑 Linux，本地多为 macOS） */
function expectedOpen(mode: 'finder' | 'terminal', target: string) {
  if (mode === 'terminal') {
    if (process.platform === 'darwin') return { cmd: 'open', args: ['-a', 'Terminal', target] };
    if (process.platform === 'win32')
      return { cmd: 'cmd', args: ['/c', 'start', 'cmd', '/K', `cd /d ${target}`] };
    return { cmd: 'x-terminal-emulator', args: [`--working-directory=${target}`] };
  }
  if (process.platform === 'darwin') return { cmd: 'open', args: [target] };
  if (process.platform === 'win32') return { cmd: 'explorer', args: [target] };
  return { cmd: 'xdg-open', args: [target] };
}

let env: Awaited<ReturnType<typeof createTempLatticeHome>>;

beforeEach(async () => {
  env = await createTempLatticeHome();
  execFileMock.mockReset();
});

afterEach(async () => {
  await env.cleanup();
});

test('openDirectory：finder/terminal 命令映射与成功回调', async () => {
  execFileMock.mockImplementation((_cmd, _args, cb) => cb(null));
  assert.deepEqual(await openDirectory('/work/proj'), {
    success: true,
    message: '已打开：/work/proj',
  });
  const finderCall = expectedOpen('finder', '/work/proj');
  assert.equal(execFileMock.mock.calls[0][0], finderCall.cmd);
  assert.deepEqual(execFileMock.mock.calls[0][1], finderCall.args);

  await openDirectory('/work/proj', 'terminal');
  const terminalCall = expectedOpen('terminal', '/work/proj');
  assert.equal(execFileMock.mock.calls[1][0], terminalCall.cmd);
  assert.deepEqual(execFileMock.mock.calls[1][1], terminalCall.args);
});

test('openDirectory：执行错误返回失败信息', async () => {
  execFileMock.mockImplementation((_cmd, _args, cb) => cb(new Error('no app')));
  const result = await openDirectory('/x');
  assert.equal(result.success, false);
  assert.match(result.message, /打开失败: no app/);
});

test('openWithEditor：支持/不支持/错误', async () => {
  execFileMock.mockImplementation((_cmd, _args, cb) => cb(null));
  for (const app of ['vscode', 'cursor', 'qoder', 'finder'] as const) {
    const result = await openWithEditor('/f', app);
    assert.equal(result.success, true, app);
  }
  assert.equal(execFileMock.mock.calls[0][0], 'code');
  assert.equal(execFileMock.mock.calls[2][0], 'qoder');
  assert.equal(execFileMock.mock.calls[3][0], 'open');

  const unsupported = await openWithEditor('/f', 'sublime' as never);
  assert.equal(unsupported.success, false);
  assert.match(unsupported.message, /不支持的应用/);

  execFileMock.mockImplementation((_cmd, _args, cb) => cb(new Error('boom')));
  const failed = await openWithEditor('/f', 'vscode');
  assert.equal(failed.success, false);
  assert.match(failed.message, /打开失败: boom/);
});

test('openLatticeRoot：指向隔离的 LATTICE_HOME', async () => {
  execFileMock.mockImplementation((_cmd, _args, cb) => cb(null));
  const result = await openLatticeRoot('terminal');
  assert.equal(result.success, true);
  const expected = expectedOpen('terminal', join(env.latticeHome));
  assert.equal(execFileMock.mock.calls[0][0], expected.cmd);
  assert.deepEqual(execFileMock.mock.calls[0][1], expected.args);
});
