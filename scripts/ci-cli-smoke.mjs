#!/usr/bin/env node
/**
 * node-compat 线：在低版本 Node（18/20）上验证「发布产物」CLI 的最小命令集。
 *
 * - 不依赖 vitest（vitest 4 要求 dev 环境 Node ≥20；本脚本跑在发布包支持的 Node 18+）
 * - 隔离：HOME / LATTICE_HOME 同指临时目录，绝不触达真实 ~/.lattice
 * - 离线：init 前预置 allowRemoteModels=false（init -f 会走模型预热路径，
 *   离线配置让其快速降级，不产生网络下载）
 *
 * 用法：node scripts/ci-cli-smoke.mjs（前置：pnpm build:core && pnpm build:cli）
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const cliEntry = join(root, 'packages', 'cli', 'dist', 'index.js');

if (!existsSync(cliEntry)) {
  console.error('✗ 缺少 CLI 构建产物：请先运行 pnpm build:core && pnpm build:cli');
  process.exit(1);
}

const home = mkdtempSync(join(tmpdir(), 'lattice-ci-smoke-'));
const latticeHome = join(home, '.lattice');

/** 隔离 + 离线 env（子进程一律继承） */
const env = { ...process.env, HOME: home, LATTICE_HOME: latticeHome, CI: '1' };

function run(args) {
  return spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', env });
}

const failures = [];
function check(name, res, validate) {
  if (res.status !== 0) {
    failures.push(`${name}: exit=${res.status}\n${res.stdout}\n${res.stderr}`);
    return;
  }
  try {
    validate?.(res);
    console.log(`✓ ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
  }
}

// init 前置：离线配置（避免 init -f 触发模型下载）
mkdirSync(join(latticeHome, 'config'), { recursive: true });
writeFileSync(
  join(latticeHome, 'config', 'config.json'),
  JSON.stringify({ rag: { embedding: { allowRemoteModels: false } } }),
);

// 1) 版本输出
check('--version', run(['--version']), (res) => {
  if (!/\d+\.\d+\.\d+/.test(res.stdout)) throw new Error(`版本输出异常：${res.stdout.trim()}`);
});

// 2) 非交互 init（-f 跳过确认；非 TTY 自动跳过 AI 工具勾选）
check('init -f', run(['init', '-f', '--username', 'ci', '--git', 'false']));

// 3) status --json
check('status --json', run(['status', '--json']), (res) => {
  JSON.parse(res.stdout);
});

// 4) project ls --json
check('project ls --json', run(['project', 'ls', '--json']), (res) => {
  JSON.parse(res.stdout);
});

// 5) task ls --json
check('task ls --json', run(['task', 'ls', '--json']), (res) => {
  JSON.parse(res.stdout);
});

rmSync(home, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`✗ CLI 冒烟失败（${failures.length} 项）：\n${failures.join('\n---\n')}`);
  process.exit(1);
}

console.log(`✓ CLI 冒烟全部通过（Node ${process.version}）`);
