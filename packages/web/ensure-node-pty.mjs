#!/usr/bin/env node
/**
 * 确保 @homebridge/node-pty-prebuilt-multiarch 的预编译二进制可用。
 *
 * pnpm 默认不运行 optionalDependencies 的安装脚本，npm 部分场景也可能跳过。
 * 此脚本在 @qcqx/lattice-web 的 postinstall 钩子中运行，手动触发 prebuild-install。
 * 失败时静默退出（终端降级 spawn 模式，功能不中断）。
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// 1. 尝试加载 node-pty，已可用则跳过
try {
  require('@homebridge/node-pty-prebuilt-multiarch');
  process.exit(0);
} catch {
  // 二进制不可用，继续
}

// 2. 定位 @homebridge 包目录
let pkgPath;
try {
  pkgPath = dirname(require.resolve('@homebridge/node-pty-prebuilt-multiarch/package.json'));
} catch {
  // 包未安装（optionalDependencies 可能没装），跳过
  process.exit(0);
}

// 3. 运行 prebuild-install 下载预编译二进制
console.log('[lattice-web] Downloading node-pty prebuilt binary...');
try {
  const pkgRequire = createRequire(join(pkgPath, 'package.json'));
  const prebuildInstallBin = pkgRequire.resolve('prebuild-install/bin.js');
  execFileSync('node', [prebuildInstallBin], {
    cwd: pkgPath,
    stdio: 'inherit',
    timeout: 60_000,
  });
  console.log('[lattice-web] node-pty prebuilt binary downloaded successfully.');
} catch {
  console.warn(
    '[lattice-web] Failed to download node-pty prebuilt binary. ' +
      'Terminal will use spawn fallback mode. ' +
      'Reinstall @qcqx/lattice-web to retry, or run npx prebuild-install manually.',
  );
}
