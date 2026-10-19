import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * 跨包源码直连 alias（各 project 配置共享）。
 *
 * 目的：单测/集成直测各包 src（改完即测，无需先 build dist）。
 * 注意：根 vitest.config.ts 的 resolve.alias 不会穿透到 file-based projects，
 * 各包 vitest.config.ts 必须显式引入本模块。
 */
export const sharedAliases: Record<string, string> = {
  '@qcqx/lattice-protocol': resolve(root, 'packages/protocol/src/index.ts'),
  '@qcqx/lattice-services': resolve(root, 'packages/services/src/index.ts'),
  '@qcqx/lattice-core': resolve(root, 'packages/core/src/index.ts'),
};
