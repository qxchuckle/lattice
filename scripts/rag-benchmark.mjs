import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = process.cwd();
const cliPath = path.join(workspaceRoot, 'packages/cli/dist/index.js');
const testHome = process.env.LATTICE_TEST_HOME ?? path.join(workspaceRoot, '.tmp-home-ragtest');
const benchmarkDir = path.join(workspaceRoot, '.temp-docs', 'benchmarks');

const cases = [
  {
    name: '精确标题',
    query: '状态管理规范',
    expectedPathSuffix: '/spec/frontend/state-management.md',
  },
  {
    name: '精确标题',
    query: '类型安全规范',
    expectedPathSuffix: '/spec/frontend/type-safety.md',
  },
  {
    name: '中文短词',
    query: '状态管理',
    expectedPathSuffix: '/spec/frontend/state-management.md',
  },
  {
    name: '中文短词',
    query: '前端目录结构',
    expectedPathSuffix: '/spec/frontend/directory-structure.md',
  },
  {
    name: '语义改写',
    query: '服务端状态应该交给谁管理',
    expectedPathSuffix: '/spec/frontend/state-management.md',
  },
  {
    name: '语义改写',
    query: '共享类型和页面类型应该放在哪里',
    expectedPathSuffix: '/spec/frontend/type-safety.md',
  },
  {
    name: '高混淆',
    query: '共享规则应该写在哪',
    expectedPathSuffix: '/spec/demo-user-template/demo-user-template/shared-rules.md',
  },
  {
    name: '高混淆',
    query: '页面级状态和全局状态怎么划分',
    expectedPathSuffix: '/spec/frontend/state-management.md',
  },
  {
    name: '高混淆',
    query: '接口 DTO 应该在哪里转换成页面模型',
    expectedPathSuffix: '/spec/frontend/type-safety.md',
  },
  {
    name: '高混淆',
    query: '组件什么时候应该进入共享组件层',
    expectedPathSuffix: '/spec/frontend/component-guidelines.md',
  },
  {
    name: '高混淆',
    query: '副作用和订阅清理放在哪层处理',
    expectedPathSuffix: '/spec/frontend/hook-guidelines.md',
  },
  {
    name: '高混淆',
    query: 'lint typecheck 和测试要求是什么',
    expectedPathSuffix: '/spec/frontend/quality-guidelines.md',
  },
  {
    name: '高混淆',
    query: '目录结构规范总览应该先读什么',
    expectedPathSuffix: '/spec/frontend/index.md',
  },
  {
    name: '问句',
    query: '什么时候抽成自定义 Hook',
    expectedPathSuffix: '/spec/frontend/hook-guidelines.md',
  },
  {
    name: '问句',
    query: '前端模块新增文件应该放在哪个目录',
    expectedPathSuffix: '/spec/frontend/directory-structure.md',
  },
  {
    name: '架构问句',
    query: '架构层面的新文件应该放在哪里',
    expectedPathSuffix: '/spec/architecture/directory-structure.md',
  },
  {
    name: '意图改写',
    query: '新增模块文件应该放在哪里',
    expectedAnyPathSuffixes: [
      '/spec/frontend/directory-structure.md',
      '/spec/architecture/directory-structure.md',
    ],
  },
];

function runSearch(query) {
  return runSearchWithArgs(query, []);
}

function runSearchWithArgs(query, extraArgs) {
  const output = execFileSync('node', [cliPath, 'search', query, '--json', ...extraArgs], {
    cwd: workspaceRoot,
    env: { ...process.env, HOME: testHome },
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

function evaluateResults(results, testCase) {
  const rankedPaths = results.map((result) => String(result.meta?.filePath ?? ''));
  const expectedSuffixes = testCase.expectedAnyPathSuffixes ?? [testCase.expectedPathSuffix];
  const matchesExpected = (filePath) =>
    expectedSuffixes.some((suffix) => typeof suffix === 'string' && filePath.endsWith(suffix));
  return {
    top1Hit: matchesExpected(rankedPaths[0] ?? ''),
    top3Hit: rankedPaths.slice(0, 3).some(matchesExpected),
    top1Path: rankedPaths[0] ?? '',
  };
}

function summarizeCase(testCase) {
  const withoutRerank = evaluateResults(
    runSearchWithArgs(testCase.query, ['--no-rerank']),
    testCase,
  );
  const withRerank = evaluateResults(runSearch(testCase.query), testCase);

  return {
    ...testCase,
    withoutRerank,
    withRerank,
  };
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function buildMarkdownReport({
  summaries,
  baseTop1Hits,
  baseTop3Hits,
  rerankTop1Hits,
  rerankTop3Hits,
  top1Gains,
  top3Gains,
  generatedAt,
}) {
  const lines = [
    '# RAG Benchmark Report',
    '',
    `生成时间：${generatedAt.toISOString()}`,
    `测试 HOME：\`${testHome}\``,
    '',
    '## Summary',
    '',
    `- baseline top1: ${baseTop1Hits}/${summaries.length}`,
    `- baseline top3: ${baseTop3Hits}/${summaries.length}`,
    `- rerank top1: ${rerankTop1Hits}/${summaries.length}`,
    `- rerank top3: ${rerankTop3Hits}/${summaries.length}`,
    `- top1 gains from rerank: ${top1Gains}`,
    `- top3 gains from rerank: ${top3Gains}`,
    '',
    '## Cases',
    '',
    '| 类别 | 查询 | baseline top1 | baseline top3 | rerank top1 | rerank top3 | rerank top1 路径 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const summary of summaries) {
    lines.push(
      `| ${summary.name} | ${summary.query} | ${summary.withoutRerank.top1Hit ? 'PASS' : 'FAIL'} | ${summary.withoutRerank.top3Hit ? 'PASS' : 'FAIL'} | ${summary.withRerank.top1Hit ? 'PASS' : 'FAIL'} | ${summary.withRerank.top3Hit ? 'PASS' : 'FAIL'} | ${summary.withRerank.top1Path} |`,
    );
  }

  lines.push(
    '',
    '## Notes',
    '',
    '- baseline 表示关闭轻量 rerank。',
    '- rerank 表示开启当前启发式轻量 rerank。',
  );

  return `${lines.join('\n')}\n`;
}

function main() {
  const generatedAt = new Date();
  const summaries = cases.map(summarizeCase);
  const baseTop1Hits = summaries.filter((summary) => summary.withoutRerank.top1Hit).length;
  const baseTop3Hits = summaries.filter((summary) => summary.withoutRerank.top3Hit).length;
  const rerankTop1Hits = summaries.filter((summary) => summary.withRerank.top1Hit).length;
  const rerankTop3Hits = summaries.filter((summary) => summary.withRerank.top3Hit).length;
  const top1Gains = summaries.filter(
    (summary) => !summary.withoutRerank.top1Hit && summary.withRerank.top1Hit,
  ).length;
  const top3Gains = summaries.filter(
    (summary) => !summary.withoutRerank.top3Hit && summary.withRerank.top3Hit,
  ).length;

  console.log(`RAG benchmark (${testHome})`);
  console.log('');
  console.log(
    '| 类别 | 查询 | baseline top1 | baseline top3 | rerank top1 | rerank top3 | rerank top1 路径 |',
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- |');

  for (const summary of summaries) {
    console.log(
      `| ${summary.name} | ${summary.query} | ${summary.withoutRerank.top1Hit ? 'PASS' : 'FAIL'} | ${summary.withoutRerank.top3Hit ? 'PASS' : 'FAIL'} | ${summary.withRerank.top1Hit ? 'PASS' : 'FAIL'} | ${summary.withRerank.top3Hit ? 'PASS' : 'FAIL'} | ${summary.withRerank.top1Path} |`,
    );
  }

  console.log('');
  console.log(`baseline top1: ${baseTop1Hits}/${summaries.length}`);
  console.log(`baseline top3: ${baseTop3Hits}/${summaries.length}`);
  console.log(`rerank top1: ${rerankTop1Hits}/${summaries.length}`);
  console.log(`rerank top3: ${rerankTop3Hits}/${summaries.length}`);
  console.log(`top1 gains from rerank: ${top1Gains}`);
  console.log(`top3 gains from rerank: ${top3Gains}`);

  mkdirSync(benchmarkDir, { recursive: true });
  const markdown = buildMarkdownReport({
    summaries,
    baseTop1Hits,
    baseTop3Hits,
    rerankTop1Hits,
    rerankTop3Hits,
    top1Gains,
    top3Gains,
    generatedAt,
  });
  const latestReportPath = path.join(benchmarkDir, 'rag-benchmark-latest.md');
  const archivedReportPath = path.join(
    benchmarkDir,
    `rag-benchmark-${formatTimestamp(generatedAt)}.md`,
  );
  writeFileSync(latestReportPath, markdown, 'utf8');
  writeFileSync(archivedReportPath, markdown, 'utf8');

  console.log('');
  console.log(`latest report: ${latestReportPath}`);
  console.log(`archived report: ${archivedReportPath}`);

  if (rerankTop3Hits !== summaries.length) {
    process.exitCode = 1;
  }
}

main();
