#!/usr/bin/env node
/**
 * CI 防静默空跑：解析 vitest JSON reporter 输出，断言用例数 ≥ 阈值且全部通过。
 * 背景：projects/glob 配置静默失效时，测试可能「0 用例全绿」——必须显式断言计数。
 *
 * 用法：node scripts/ci-assert-tests.mjs <vitest-json-results> [minTests]
 */
import { readFileSync } from 'node:fs';

const [, , file, minRaw] = process.argv;
const min = minRaw ? Number.parseInt(minRaw, 10) : 1;

if (!file) {
  console.error('用法：node scripts/ci-assert-tests.mjs <vitest-json-results> [minTests]');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`✗ 无法读取测试结果 JSON：${file}（${err.message}）`);
  process.exit(1);
}

const total = report.numTotalTests ?? 0;
const passed = report.numPassedTests ?? 0;
const failed = report.numFailedTests ?? 0;

if (total < min) {
  console.error(`✗ 测试计数异常：${total} < 阈值 ${min}（疑似 glob/projects 配置静默失效）`);
  process.exit(1);
}
if (failed > 0 || passed !== total) {
  console.error(`✗ 测试结果异常：total=${total} passed=${passed} failed=${failed}`);
  process.exit(1);
}

console.log(`✓ 测试计数断言通过：${passed}/${total}（阈值 ${min}）`);
