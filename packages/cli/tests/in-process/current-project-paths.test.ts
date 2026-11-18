import { expect, test, vi } from 'vitest';
import { resolveAndRegisterUpwards } from '../../src/utils/current-project';

const { fileExists } = vi.hoisted(() => ({ fileExists: vi.fn() }));

vi.mock('node:path', async (original) => {
  const actual = await original<typeof import('node:path')>();
  return { ...actual, ...actual.win32 };
});

vi.mock('@qcqx/lattice-core', () => ({
  fileExists,
  initDb: async () => {},
  getUsername: async () => 'test-user',
}));

test.each([
  ['C:\\work\\project', ['C:\\work\\project', 'C:\\work']],
  ['\\\\host\\share\\work', ['\\\\host\\share\\work']],
])('stops walking ancestors before a Windows root for %s', async (startDir, dirs) => {
  fileExists.mockReset().mockImplementation(async () => {
    if (fileExists.mock.calls.length > 8) throw new Error('Ancestor scan did not terminate');
    return false;
  });

  await expect(resolveAndRegisterUpwards(startDir)).resolves.toBeNull();
  expect(fileExists.mock.calls.map(([file]) => file)).toEqual(
    dirs.flatMap((dir) => [dir + '\\.git', dir + '\\lattice.json']),
  );
});
