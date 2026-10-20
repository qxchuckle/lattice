import type { Command } from 'commander';
import { findProjectionEntry, jsonFullHintFor, isPaginatedCommand } from './projection-manifest';

/**
 * CLI 叶子命令选项装配（从 index.ts 抽出：无行为变化，供进程内测试直接复用）。
 *
 * 唯一真源仍是投影声明表（projection-manifest）；这里只做「按声明补选项」的机械动作。
 */

/** 遍历命令树的**叶子命令**；`commandPath` 是空格分隔的全路径（不含程序名，如 `fast-start log list`）。 */
export function walkLeafCommands(
  cmd: Command,
  path: string[],
  visit: (leaf: Command, commandPath: string) => void,
): void {
  if (cmd.commands.length === 0) {
    visit(cmd, path.join(' '));
    return;
  }
  for (const sub of cmd.commands) {
    walkLeafCommands(sub, [...path, sub.name()], visit);
  }
}

/** `config set` 的 `--json` 是把输入 value 按 JSON 解析，不是输出格式控制（也不配 `--json-format`） */
function isConfigSet(leaf: Command): boolean {
  return leaf.name() === 'set' && leaf.parent?.name() === 'config';
}

/** `--json` 的帮助文案：注册无条件（machine 模式开关），文案按有无 JSON 数据出口分支。 */
function jsonHintFor(leaf: Command, commandPath: string): string {
  if (isConfigSet(leaf)) return '将 value 按 JSON 解析';
  if (findProjectionEntry(commandPath)) return 'JSON 格式输出';
  return 'JSON 格式输出；本命令无 JSON 数据出口，成功仍出人读文本，失败提示走 stderr 且退出码 1';
}

/**
 * 给**叶子命令**补齐缺失的选项，避免 AI 调用时因 unknown option 报错。
 *
 * **只补叶子，绝不补父命令**：commander 里祖先声明的同名选项会**遮蔽**后代的——实测给
 * 「父命令自带 action」的形态（`sync` / `config`）补 `--json` 后，`sync domain list --json`
 * 与 `config get <key> --json` 的 `opts().json` 变成 undefined，JSON 出口直接失效。
 *
 * `--json-full` 与翻页参数由投影声明表驱动；`--json` 的**注册**不由声明表驱动（无条件补
 * 全部叶子，因为它是 machine 模式开关），hint **文案**按声明表分支。
 */
export function ensureLeafOptions(leaf: Command, commandPath: string): void {
  const add = (
    long: string,
    flags: string,
    description: string,
    parser?: (value: string, previous: number) => number,
  ): void => {
    if (leaf.options.some((opt) => opt.long === long)) return;
    if (parser) leaf.option(flags, description, parser);
    else leaf.option(flags, description);
  };

  add('--force', '-f, --force', '跳过确认');
  add('--debug', '-d, --debug', '输出调试信息');
  add('--json', '--json', jsonHintFor(leaf, commandPath));
  // --json-format 与 --json 成对出现；config set 除外（其 --json 是输入 value 的解析语义，无输出排版）
  if (!isConfigSet(leaf)) {
    add('--json-format', '--json-format', 'JSON 输出时使用格式化（默认压缩）');
  }

  const fullHint = jsonFullHintFor(commandPath);
  if (fullHint) add('--json-full', '--json-full', fullHint);
  if (isPaginatedCommand(commandPath)) {
    add('--page', '--page <n>', '页码（1-based，配合 --page-size；默认输出全部）', parseInt);
    add('--page-size', '--page-size <n>', '每页条数（不传则一次输出全部）', parseInt);
  }
}

/** 对整棵命令树应用叶子选项装配（index.ts 在注册完全部命令后调用）。 */
export function applyLeafOptions(program: Command): void {
  walkLeafCommands(program, [], ensureLeafOptions);
}
