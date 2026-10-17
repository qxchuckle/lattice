import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  files: 'tests/integration/**/*.test.cjs',
  workspaceFolder: 'tests/integration/fixtures/workspace',
  version: 'stable',
  // 固定隔离数据根：扩展激活早期即经 LATTICE_HOME 重定向（core 的默认根解析），
  // 保证任何时点的读取都不会触达真实 ~/.lattice。
  env: {
    LATTICE_HOME: resolve(here, '.vscode-test', 'lattice-home'),
    // 集成测试无法点击模态确认弹窗：批量命令跳过确认（仅测试宿主）
    LATTICE_TEST_SKIP_CONFIRM: '1',
  },
  mocha: {
    timeout: 120000,
  },
});
