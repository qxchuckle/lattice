import { Command } from 'commander';
import { basename, dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runStartupSelfCheck, closeDb, readInitMeta, isInitialized } from '@qcqx/lattice-core';
import {
  resolveCurrentProject,
  logger,
  setMachineMode,
  jsonFullHintFor,
  isPaginatedCommand,
} from './utils';
import { registerInitCommand } from './commands/init';
import { registerUninjectCommand } from './commands/uninject';
import { registerLinkCommand } from './commands/link';
import { registerUnlinkCommand } from './commands/unlink';
import { registerScanCommand } from './commands/scan';
import { registerProjectCommand } from './commands/project';
import { registerTaskCommand } from './commands/task';
import { registerSpecCommand } from './commands/spec';
import { registerStatusCommand, registerOpenCommand } from './commands/status';
import { registerContextCommand } from './commands/context';
import { registerConfigCommand } from './commands/config';
import { registerSearchCommand } from './commands/search';
import { registerDoctorCommand } from './commands/doctor';
import { registerSyncCommand } from './commands/sync';
import { registerUserCommand } from './commands/user';
import { registerRagCommand } from './commands/rag';
import { registerTrashCommand } from './commands/trash';
import { registerWebCommand } from './commands/web';
import { registerFastStartCommand } from './commands/fast-start';

const program = new Command();
const invokedAs = process.argv[1] ? basename(process.argv[1]) : 'lattice';
const cliName = invokedAs === 'index.js' ? 'lattice' : invokedAs;

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));

program.name(cliName).description('Lattice — 跨项目 AI 上下文管理工具').version(pkg.version);

registerInitCommand(program);
registerUninjectCommand(program);
registerLinkCommand(program);
registerUnlinkCommand(program);
registerScanCommand(program);
registerProjectCommand(program);
registerTaskCommand(program);
registerSpecCommand(program);
registerStatusCommand(program);
registerOpenCommand(program);
registerContextCommand(program);
registerConfigCommand(program);
registerSearchCommand(program);
registerDoctorCommand(program);
registerSyncCommand(program);
registerUserCommand(program);
registerRagCommand(program);
registerTrashCommand(program);
registerWebCommand(program);
registerFastStartCommand(program);

/**
 * 遍历命令树的**叶子命令**；`commandPath` 是空格分隔的全路径（不含程序名，如 `fast-start log list`）。
 */
function walkLeafCommands(
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

/**
 * 命令选项兜底：给**叶子命令**补齐缺失的选项，避免 AI 调用时因 unknown option 报错。
 *
 * **只补叶子，绝不补父命令**：commander 里祖先声明的同名选项会**遮蔽**后代的——实测给
 * 「父命令自带 action」的形态（`sync` / `config`）补 `--json` 后，`sync domain list --json`
 * 与 `config get <key> --json` 的 `opts().json` 变成 undefined，JSON 出口直接失效。
 * 代价：`ltc sync --json` 这类「父命令自带 action」的调用会报 unknown option，
 * 属可接受的例外（已在 command-reference.md 记录），远优于静默破坏子命令的 JSON 出口。
 *
 * `--json-full` 与翻页参数**由投影声明表驱动**（`utils/projection-manifest.ts`）：hint 文案与
 * 「哪些命令接翻页」都只有一份真源，命令文件不手写。`detail` / `raw` 类命令查不到 hint →
 * 不注册 `--json-full`（避免声明了却与默认输出无差异的死选项）。
 *
 * `--json` **不由声明表驱动**（无条件补全部叶子）：它是 machine 模式开关（`preAction` 里
 * `machineOutput = json || quiet` → `setMachineMode`），不是投影开关——无 JSON 数据出口的写命令
 * 靠它把失败提示改道 stderr + 退出码 1，且多数没有 `-q`，删掉即复活「未找到 X 吐 stdout 且退出 0」
 * 的缺陷，也会让 SKILL.md「ltc 命令必须带 --json」在这些命令上报 unknown option。
 * 判据：**选项是否只在「有 JSON 数据出口」时才有意义**——是 → 声明表驱动；否 → 无条件补。
 */
function ensureLeafOptions(leaf: Command, commandPath: string): void {
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
  add(
    '--json',
    '--json',
    'JSON 格式输出；无 JSON 数据出口的命令成功时仍出人读文本，失败提示走 stderr 且退出码 1',
  );
  // --json-format 与 --json 成对出现；config set 除外（其 --json 是输入 value 的解析语义，无输出排版）
  if (!(leaf.name() === 'set' && leaf.parent?.name() === 'config')) {
    add('--json-format', '--json-format', 'JSON 输出时使用格式化（默认压缩）');
  }

  const fullHint = jsonFullHintFor(commandPath);
  if (fullHint) add('--json-full', '--json-full', fullHint);
  if (isPaginatedCommand(commandPath)) {
    add('--page', '--page <n>', '页码（1-based，配合 --page-size；默认输出全部）', parseInt);
    add('--page-size', '--page-size <n>', '每页条数（不传则一次输出全部）', parseInt);
  }
}

walkLeafCommands(program, [], ensureLeafOptions);

async function main(): Promise<void> {
  // 进程退出时确保 DB 正确关闭（WAL checkpoint）
  process.on('exit', () => closeDb());

  // rag rebuild / rag update 本身会处理索引重建，跳过 startup-self-check 的提示
  // 使用 commander 的 preAction hook：在 action 执行前、命令解析后触发
  program.hook('preAction', async (_thisCommand, actionCommand) => {
    const name = actionCommand.name();
    const parentName = actionCommand.parent?.name();
    const isRagIndexCmd = parentName === 'rag' && (name === 'rebuild' || name === 'update');

    // machine 输出模式（--json / -q）：stdout 只留数据，preAction 的提示性输出一律静音，从根源排除对 $(...)/管道解析的污染
    // --json-full 是 --json 的形态开关：单独给出时隐含 JSON 输出，否则命令静默走人读分支、
    // $(...) 捕到的不是数据（与 machine 纯净度同源）
    if (actionCommand.opts().jsonFull && !actionCommand.opts().json) {
      actionCommand.setOptionValue('json', true);
    }
    const cmdOpts = actionCommand.opts();
    const machineOutput = Boolean(cmdOpts.json || cmdOpts.quiet);
    // 统一设置 machine 模式标志：命令内的失败/空态提示据此走 stderr（见 utils/machine-output.ts）
    setMachineMode(machineOutput);

    if (!isRagIndexCmd) {
      try {
        const checkResult = await runStartupSelfCheck();
        if (checkResult.ragRebuildNeeded && !machineOutput) {
          console.warn('⚠ DB schema 已升级，建议运行 `lattice rag rebuild` 重建搜索索引');
        }
      } catch {
        // 启动自检失败不阻断主命令执行
      }
    }

    // init-meta 版本检查：agent 文档是否过期（init 命令本身跳过；未初始化时跳过）
    if (name !== 'init') {
      try {
        if (await isInitialized()) {
          const meta = await readInitMeta();
          if ((!meta || meta.version !== pkg.version) && !machineOutput) {
            console.warn('\x1b[33m⚠ lattice 注入已过期，运行 ltc init 更新\x1b[0m');
          }
        }
      } catch {
        // 检查失败不阻断主命令执行
      }
    }

    // 自动注册守卫：向上查找 ID 源（.git / lattice.json）并注册未注册项目
    try {
      await resolveCurrentProject(process.cwd(), { silentNotice: machineOutput });
    } catch {
      // 自动注册失败不阻断主命令执行
    }
  });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  // 顶层兜底：error 对象转 string 后经 logger.stderr 统一 home→~ 化（stack/message 可能含绝对路径）
  logger.stderr(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
