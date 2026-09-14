#!/usr/bin/env node
/**
 * 投影声明表 ↔ 命令源码 ↔ 模板文档 三方一致性校验。
 *
 * 单一真源是 `src/utils/projection-manifest.ts`：`--json-full` 与 `--page`/`--page-size` 由
 * `src/index.ts` 的 walker 从它派生注册，选项层不会漂移。本脚本负责剩下两方——命令源码的
 * 投影调用形态、模板文档（hub 清单 + `cli-*.md` 参数字典）——与声明表的一致性。
 *
 * | 编号 | 校验 | 抓的漂移类型 |
 * |---|---|---|
 * | E0 | 声明表自身完整（kind/doc 合法、command 唯一、必填字段齐） | 声明写错 |
 * | E1 | 声明表里的命令路径在源码命令树中存在 | 声明了不存在 / 已改名的命令 |
 * | E2 | 源码里有 JSON 出口（`outputJson`）的叶子命令都在声明表里 | 新命令漏声明 |
 * | E3 | `detail` / `raw` 命令块内无 `'--json-full'` 字面量 | 死选项回潮 |
 * | E4 | `kind` 与块内实际调用的投影函数一致 | 声明与实现不符 |
 * | E5 | hub 三份清单与声明表派生集合逐字一致 | 清单漏项 / 多项 |
 * | E6 | 每个命令在其 `doc` 分片里被提及 | 代码有、文档无 |
 * | E7 | 走瘦身层的命令段落必须写 `--json-full`；不走的不得把它写成可用选项 | 文档有、代码无 |
 * | E8 | 分段落提到的每个 `--xxx` 选项在该段命令的实际选项集合里 | 文档声称不存在的选项 |
 * | E9 | 声明表条目数 == 源文件 `command:` 行数 | 本脚本的解析器过时 |
 *
 * 文本清洗（避免误报）：否定式提及（"故不设 `--json-full`"）与交叉引用（`ltc 其他命令 --xxx`）
 * 先移除；选项只从反引号项提取（散文里的裸 `--xxx` 是叙述不是参数字典）；正文内联子命令项
 * 必须带参数占位符才参与归属（`list [--json]` 是命令列举，`tree` 可能只是字段名）。
 *
 * 用法：`pnpm check:cli-doc`（仓库根）或 `node packages/cli/scripts/check-projection-doc-sync.mjs`
 * 退出码：0 = 一致；1 = 有 ERROR
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI_SRC = resolve(here, '../src');
const COMMANDS_DIR = join(CLI_SRC, 'commands');
const MANIFEST_PATH = join(CLI_SRC, 'utils/projection-manifest.ts');
const SKILLS_DIR = resolve(here, '../../core/public/templates/skills');
const HUB_PATH = join(SKILLS_DIR, 'command-reference.md');

const KINDS = ['table', 'list', 'item', 'detail', 'raw'];
const SHARDS = [
  'cli-context-search.md',
  'cli-project.md',
  'cli-task.md',
  'cli-spec.md',
  'cli-sync-user.md',
  'cli-system.md',
];
/** kind → 块内应出现的投影入口（任一命中即通过；raw 要求一个都不出现） */
const PROJECTORS = {
  table: ['projectTable'],
  list: ['projectList'],
  item: ['projectItem', 'projectList'],
  detail: ['dedupeItem'],
  raw: [],
};
const ALL_PROJECTORS = [
  'projectTable',
  'projectList',
  'projectItem',
  'dedupeItem',
  'compactItem',
  'toTable',
];
/** walker 给叶子命令兜底的通用选项（与 src/index.ts 的 ensureLeafOptions 对应） */
const WALKER_OPTIONS = ['--force', '--debug', '--json', '--json-format'];
/** 命令名词形（排除参数占位符、选项、`a|b` 之类的值枚举） */
const CMD_WORD = /^[a-z][a-z0-9-]*$/;

const errors = [];
const infos = [];

/* ─── 声明表解析 ─── */

/** 从 `command:` 锚点回溯到条目起始 `{`，再按括号平衡取整个对象字面量（文案里的 {cols,rows} 成对，不影响深度） */
function objectBlock(src, fromIndex) {
  const open = src.lastIndexOf('{', fromIndex);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

function parseManifest() {
  const src = readFileSync(MANIFEST_PATH, 'utf8');
  // 不锚定行首：单行写法 `{ command: 'x', kind: 'raw', ... }` 同样要解析到，否则校验静默漏检
  const anchors = [...src.matchAll(/\bcommand:\s*'([^']+)'/g)];
  const entries = anchors.map((m) => {
    const block = objectBlock(src, m.index);
    const pick = (key) => {
      const f = block.match(new RegExp(`\\b${key}:\\s*'([^']*)'`));
      return f ? f[1] : undefined;
    };
    return {
      command: m[1],
      kind: pick('kind'),
      doc: pick('doc'),
      fullHint: pick('fullHint'),
      note: pick('note'),
    };
  });

  // E9：解析条目数必须等于源文件里 command: 的出现次数
  const declared = (src.match(/\bcommand:\s*'/g) || []).length;
  if (declared !== entries.length) {
    errors.push(
      `[E9] 声明表解析器过时：源文件有 ${declared} 条 command，解析出 ${entries.length} 条（格式变了需更新本脚本）`,
    );
  }

  // E0：自身完整性
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.command)) errors.push(`[E0] 声明表命令重复：${e.command}`);
    seen.add(e.command);
    if (!KINDS.includes(e.kind)) errors.push(`[E0] ${e.command}：kind 非法（${e.kind}）`);
    if (!SHARDS.includes(e.doc)) {
      errors.push(`[E0] ${e.command}：doc 不是 6 个分片之一（${e.doc}）`);
    }
    const isProjected = e.kind === 'table' || e.kind === 'list' || e.kind === 'item';
    if (isProjected && !e.fullHint) errors.push(`[E0] ${e.command}：kind=${e.kind} 缺 fullHint`);
    if (!isProjected && !e.note) {
      errors.push(`[E0] ${e.command}：kind=${e.kind} 缺 note（须记录已评估理由）`);
    }
  }
  return entries;
}

/* ─── 命令源码解析 ─── */

const stripArgs = (name) => name.split(/\s+/)[0];
const joinPath = (prefix, name) => (prefix ? `${prefix} ${stripArgs(name)}` : stripArgs(name));

function parseSources() {
  const files = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.ts'));
  /** path -> { file, leaf, options:Set, body, scope, helperNames } */
  const commands = new Map();
  const helpers = new Map();

  for (const file of files) {
    const src = readFileSync(join(COMMANDS_DIR, file), 'utf8');

    const fnAnchors = [...src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm)];
    const fnRanges = fnAnchors.map((m, i) => ({
      name: m[1],
      start: m.index,
      end: i + 1 < fnAnchors.length ? fnAnchors[i + 1].index : src.length,
    }));
    for (const r of fnRanges) {
      if (!r.name.startsWith('register')) helpers.set(r.name, src.slice(r.start, r.end));
    }
    const registerRange = fnRanges.find((r) => r.name.startsWith('register'));
    if (!registerRange) continue;
    const body = src.slice(registerRange.start, registerRange.end);
    const bodyStart = registerRange.start;

    // 变量 → 命令路径（迭代解析 const x = y.command('z') 链）
    const paths = { program: '' };
    for (let round = 0; round < 8; round += 1) {
      let changed = false;
      for (const m of body.matchAll(/const\s+(\w+)\s*=\s*(\w+)\s*\.command\(\s*'([^']+)'/g)) {
        const [, varName, recv, name] = m;
        if (recv in paths && !(varName in paths)) {
          paths[varName] = joinPath(paths[recv], name);
          changed = true;
        }
      }
      if (!changed) break;
    }

    const decls = [];
    for (const m of body.matchAll(/(\w+)\s*\.command\(\s*'([^']+)'/g)) {
      const recv = m[1];
      if (!(recv in paths)) {
        infos.push(`${file}：无法解析 .command('${m[2]}') 的接收者 ${recv}（变量映射缺失）`);
        continue;
      }
      decls.push({ path: joinPath(paths[recv], m[2]), at: bodyStart + m.index });
    }
    decls.sort((a, b) => a.at - b.at);
    decls.forEach((d, i) => {
      const end = i + 1 < decls.length ? decls[i + 1].at : bodyStart + body.length;
      const blockSrc = src.slice(d.at, end);
      const options = new Set();
      for (const om of blockSrc.matchAll(/\.(?:requiredOption|option)\(\s*'([^']+)'/g)) {
        for (const long of om[1].matchAll(/--[a-z][a-z0-9-]*/g)) options.add(long[0]);
      }
      const called = new Set([...blockSrc.matchAll(/(\w+)\s*\(/g)].map((m) => m[1]));
      commands.set(d.path, { file, options, body: blockSrc, called });
    });
  }

  for (const [path, c] of commands) {
    c.leaf = ![...commands.keys()].some((other) => other.startsWith(`${path} `));
    c.helperNames = [...c.called].filter((n) => helpers.has(n));
    // 命令块 + 它调用的顶层 helper 体（status 的投影在 showProjectStatus / showGlobalStatus 里）
    c.scope = c.body + c.helperNames.map((n) => helpers.get(n)).join('\n');
  }
  return commands;
}

/* ─── 模板文档解析 ─── */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const backticks = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** `ltc x y <arg> --opt` 形式的反引号项 → 命令路径 */
function ltcPath(item) {
  return item
    .replace(/^ltc\s+/, '')
    .split(/\s+/)
    .filter((w) => CMD_WORD.test(w))
    .join(' ');
}

function titlePaths(title) {
  return backticks(title)
    .filter((i) => i.startsWith('ltc '))
    .map(ltcPath);
}

function parseShard(text) {
  const sections = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (/^#{2,3} /.test(line)) {
      if (cur) sections.push(cur);
      cur = { title: line, body: '', paths: titlePaths(line) };
    } else if (cur) {
      cur.body += `${line}\n`;
    }
  }
  if (cur) sections.push(cur);
  return sections;
}

/**
 * 命令 C 是否在文本里被提及：
 * (a) 有反引号项以 `ltc C` 开头；或
 * (b) 有反引号项以 `ltc P` 开头（P 是 C 的词级真前缀）且 C 剩余部分的首词以反引号项出现
 *     （分片对子命令常写「父标题 + 内联 `list [--json]`」，如 `## ltc user` 段内的 user list）
 */
function isMentioned(text, command) {
  if (new RegExp(`\`ltc ${escapeRe(command)}(?=[ <\`\\]/])`).test(text)) return true;
  const words = command.split(' ');
  for (let i = words.length - 1; i >= 1; i -= 1) {
    const prefix = words.slice(0, i).join(' ');
    if (!new RegExp(`\`ltc ${escapeRe(prefix)}(?=[ <\`\\]/])`).test(text)) continue;
    if (new RegExp(`\`${escapeRe(words[i])}(?=[\\s\`\\[/<])`).test(text)) return true;
  }
  return false;
}

/** 移除交叉引用（`ltc 其他命令 --xxx`）与否定式提及（"故不设 `--json-full`"） */
function cleanText(text, sectionCmds) {
  // 交叉引用精确判定：`ltc a b --opt` 的命令路径必须就是本段命令，否则整项移除
  // （父命令前缀不算——`sync` 段里的 `ltc sync domain list --json` 是子命令的选项，不是 sync 的）
  const withoutRefs = text.replace(/`ltc ([^`]+)`/g, (whole, inner) =>
    sectionCmds.includes(ltcPath(`ltc ${inner}`)) ? whole : '',
  );
  return withoutRefs.replace(/(?:不设|无|没有|不需要|不接|不接受)[^。\n]{0,16}?`--[\w-]+`/g, '');
}

/* ─── 解析 ─── */

const entries = parseManifest();
const commands = parseSources();
const manifestByCommand = new Map(entries.map((e) => [e.command, e]));
const allCommands = new Set(entries.map((e) => e.command));
const projectedSet = new Set(
  entries.filter((e) => ['table', 'list', 'item'].includes(e.kind)).map((e) => e.command),
);
const detailSet = new Set(entries.filter((e) => e.kind === 'detail').map((e) => e.command));
const tableSet = new Set(entries.filter((e) => e.kind === 'table').map((e) => e.command));

const shardCache = new Map();
function loadShard(name) {
  if (shardCache.has(name)) return shardCache.get(name);
  const p = join(SKILLS_DIR, name);
  if (!existsSync(p)) {
    errors.push(`[E6] 分片不存在：${name}`);
    shardCache.set(name, null);
    return null;
  }
  const text = readFileSync(p, 'utf8');
  const value = { text, sections: parseShard(text) };
  shardCache.set(name, value);
  return value;
}

// 有独立标题的命令：只归属自己的标题段，避免"正文交叉引用"被当成段命令
const titledCommands = new Set();
for (const name of SHARDS) {
  const shard = loadShard(name);
  if (!shard) continue;
  for (const s of shard.sections) {
    for (const p of s.paths) if (commands.has(p)) titledCommands.add(p);
    const [first] = s.paths;
    if (!first) continue;
    for (const item of backticks(s.title)) {
      if (item.startsWith('ltc ')) continue;
      const words = item.split(/\s+/).filter((w) => CMD_WORD.test(w));
      if (words.length === 0) continue;
      const pw = first.split(' ');
      for (let i = pw.length; i >= 1; i -= 1) {
        const cand = [...pw.slice(0, i), ...words].join(' ');
        if (commands.has(cand)) {
          titledCommands.add(cand);
          break;
        }
      }
    }
  }
}

/** 段内命令全集：标题路径 + 标题里的兄弟项 + 正文内联子命令（须带参数占位符且无独立标题） */
function sectionCommands(section) {
  const set = new Set();
  const [first] = section.paths;
  for (const p of section.paths) if (commands.has(p)) set.add(p);

  const combine = (words) => {
    if (!first) return;
    const pw = first.split(' ');
    for (let i = pw.length; i >= 1; i -= 1) {
      const cand = [...pw.slice(0, i), ...words].join(' ');
      if (commands.has(cand)) set.add(cand);
    }
  };

  for (const item of backticks(section.title)) {
    if (item.startsWith('ltc ')) continue;
    const words = item.split(/\s+/).filter((w) => CMD_WORD.test(w));
    if (words.length > 0) combine(words);
  }
  for (const item of backticks(section.body)) {
    if (item.startsWith('ltc ') || !/[<[]/.test(item)) continue; // 无占位符 → 可能是字段名而非命令列举
    const words = item.split(/\s+/).filter((w) => CMD_WORD.test(w));
    if (words.length === 0) continue;
    const before = new Set(set);
    combine(words);
    // 正文里的交叉引用（"id 见 `relation list`"）不是本段命令：有独立标题的一律剔除
    for (const added of set) {
      if (!before.has(added) && titledCommands.has(added)) set.delete(added);
    }
  }
  return set;
}

/** 命令的实际选项集合：源码声明 + walker 兜底（叶子）+ 声明表派生 */
function optionsOf(path) {
  const c = commands.get(path);
  const set = new Set(c ? c.options : []);
  if (c?.leaf) {
    for (const o of WALKER_OPTIONS) {
      if (o === '--json-format' && path === 'config set') continue;
      set.add(o);
    }
  }
  const e = manifestByCommand.get(path);
  if (e) {
    if (['table', 'list', 'item'].includes(e.kind)) set.add('--json-full');
    if (e.kind === 'table') set.add('--page').add('--page-size');
  }
  return set;
}

/* ─── E1：声明表命令必须存在于源码命令树 ─── */
for (const e of entries) {
  if (!commands.has(e.command)) errors.push(`[E1] 声明表命令在源码里不存在：${e.command}`);
}

/* ─── E2：有 JSON 出口的叶子命令必须在声明表里 ─── */
for (const [path, c] of commands) {
  if (!c.leaf || !/outputJson\(/.test(c.body)) continue;
  if (!manifestByCommand.has(path)) {
    errors.push(`[E2] ${path}（${c.file}）有 outputJson 出口但未在声明表登记`);
  }
}
for (const [path, c] of commands) {
  if (
    c.leaf &&
    c.helperNames.length &&
    !/outputJson\(/.test(c.body) &&
    /outputJson\(/.test(c.scope)
  ) {
    infos.push(`${path} 的 JSON 出口在 helper（${c.helperNames.join(' / ')}）里，已并入校验范围`);
  }
}

/* ─── E3 + E4：死选项与投影形态 ─── */
for (const e of entries) {
  const c = commands.get(e.command);
  if (!c) continue;
  if ((e.kind === 'detail' || e.kind === 'raw') && /'--json-full'/.test(c.body)) {
    errors.push(`[E3] ${e.command} 是 ${e.kind} 类却在源码声明了 --json-full（死选项）`);
  }
  const wanted = PROJECTORS[e.kind] ?? [];
  if (wanted.length > 0 && !wanted.some((fn) => new RegExp(`\\b${fn}\\(`).test(c.scope))) {
    errors.push(`[E4] ${e.command} 声明 kind=${e.kind}，但块内未调用 ${wanted.join(' / ')}`);
  }
  if (e.kind === 'raw') {
    const leaked = ALL_PROJECTORS.filter((fn) => new RegExp(`\\b${fn}\\(`).test(c.scope));
    if (leaked.length > 0) {
      errors.push(`[E4] ${e.command} 声明 kind=raw，但块内调用了投影函数 ${leaked.join(' / ')}`);
    }
  }
}

/* ─── E5：hub 三份清单 ─── */
const hubLines = readFileSync(HUB_PATH, 'utf8').split('\n');
const namesIn = (segment) => new Set(backticks(segment).filter((n) => allCommands.has(n)));

function compareSets(label, got, expected) {
  const missing = [...expected].filter((x) => !got.has(x));
  const extra = [...got].filter((x) => !expected.has(x));
  if (missing.length || extra.length) {
    const fmt = (arr) => arr.map((x) => `\`${x}\``).join(' ') || '无';
    errors.push(`[E5] hub ${label}与声明表不一致：缺 ${fmt(missing)}、多 ${fmt(extra)}`);
  }
}

const fullLine = hubLines.find((l) => l.includes('适用命令：'));
if (!fullLine) errors.push('[E5] hub 缺少「适用命令：」清单行（--json-full 段）');
else
  compareSets('--json-full 适用命令清单', namesIn(fullLine.split('适用命令：')[1]), projectedSet);

const detailLine = hubLines.find((l) => l.includes('detail 命令（'));
if (!detailLine) errors.push('[E5] hub 缺少「detail 命令（」清单行');
else {
  const seg = detailLine.match(/detail 命令（([^）]*)）/);
  compareSets('detail 命令清单', namesIn(seg ? seg[1] : ''), detailSet);
}

const pageLine = hubLines.find((l) => l.includes('list 类命令通用翻页'));
if (!pageLine) errors.push('[E5] hub 缺少「list 类命令通用翻页」清单行');
else {
  const seg = pageLine.match(/list 类命令通用翻页\*\*（([^）]*)）/);
  compareSets('翻页命令清单', namesIn(seg ? seg[1] : ''), tableSet);
}

/* ─── E6：命令必须在其分片被提及 ─── */
for (const e of entries) {
  const shard = loadShard(e.doc);
  if (!shard) continue;
  if (!isMentioned(shard.text, e.command)) {
    errors.push(`[E6] ${e.command} 未在 ${e.doc} 出现（代码有、文档无）`);
  }
}

/* ─── E7 + E8：分段落级校验 ─── */
for (const name of SHARDS) {
  const shard = loadShard(name);
  if (!shard) continue;
  for (const section of shard.sections) {
    const cmds = [...sectionCommands(section)];
    if (cmds.length === 0) continue;
    const label = section.title.replace(/^#+\s*/, '').slice(0, 60);
    const cleaned = cleanText(section.title + '\n' + section.body, cmds);
    const declared = cmds.map((c) => manifestByCommand.get(c)).filter(Boolean);
    const hasProjected = declared.some((d) => ['table', 'list', 'item'].includes(d.kind));
    const hasPlain = declared.some((d) => d.kind === 'detail' || d.kind === 'raw');
    const mentions = /--json-full/.test(cleaned);

    if (hasProjected && !mentions) {
      const list = declared
        .filter((d) => ['table', 'list', 'item'].includes(d.kind))
        .map((d) => d.command)
        .join(' / ');
      errors.push(
        `[E7] ${name}「${label}」段有走瘦身层的命令（${list}）但未把 --json-full 写成可用选项`,
      );
    }
    if (!hasProjected && hasPlain && mentions) {
      errors.push(
        `[E7] ${name}「${label}」段命令均为 detail/raw（${declared
          .map((d) => d.command)
          .join(' / ')}），却把 --json-full 写成了可用选项（死选项）`,
      );
    }
    if (hasProjected && hasPlain) {
      infos.push(
        `${name}「${label}」段混合 projected 与 detail/raw 命令，--json-full 负向判定已跳过`,
      );
    }

    const allowed = new Set();
    for (const c of cmds) for (const o of optionsOf(c)) allowed.add(o);
    const mentioned = new Set();
    for (const item of backticks(cleaned)) {
      for (const m of item.matchAll(/--[a-z][a-z0-9-]*/g)) mentioned.add(m[0]);
    }
    const unknown = [...mentioned].filter((o) => !allowed.has(o));
    if (unknown.length > 0) {
      errors.push(
        `[E8] ${name}「${label}」段提到不存在的选项 ${unknown.join(' ')}（段内命令：${cmds.join(' / ')}）`,
      );
    }
  }
}

/* ─── 输出 ─── */

const counts = entries.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});
console.log(
  `声明表 ${entries.length} 条（${Object.entries(counts)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ')}）· 源码命令 ${commands.size} 个（叶子 ${
    [...commands.values()].filter((c) => c.leaf).length
  }）· 有独立标题的命令 ${titledCommands.size} 个`,
);
for (const m of infos) console.log(`  INFO  ${m}`);
if (errors.length > 0) {
  console.log('');
  for (const m of errors) console.log(`  ERROR ${m}`);
  console.log(`\n✖ ${errors.length} 处漂移`);
  process.exit(1);
}
console.log('✓ 三方一致（声明表 / 命令源码 / hub 与 6 个分片）');
