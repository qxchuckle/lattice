import { Command } from 'commander';
import { basename, dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runStartupSelfCheck, closeDb, readInitMeta, isInitialized } from '@qcqx/lattice-core';
import { resolveCurrentProject, logger, setMachineMode } from './utils';
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
 * 命令选项兜底：遍历命令树，给**叶子命令**补齐缺失的选项，避免 AI 调用时因 unknown option
 * 报错（`--force` / `--debug` / `--json` / `--json-format`）。
 *
 * **只补叶子，绝不补父命令**：commander 里祖先声明的同名选项会**遮蔽**后代的——实测给
 * 「父命令自带 action」的形态（`sync` / `config`）补 `--json` 后，`sync domain list --json`
 * 与 `config get <key> --json` 的 `opts().json` 变成 undefined，JSON 出口直接失效。
 * 代价：`ltc sync --json` 这类「父命令自带 action」的调用会报 unknown option，
 * 属可接受的例外（已在 command-reference.md 记录），远优于静默破坏子命令的 JSON 出口。
 */
function ensureOption(
  cmd: Command,
  long: string,
  flags: string,
  description: string,
  skip?: (c: Command) => boolean,
): void {
  if (cmd.commands.length === 0) {
    if (!cmd.options.some((opt) => opt.long === long) && !skip?.(cmd)) {
      cmd.option(flags, description);
    }
    return;
  }
  for (const sub of cmd.commands) {
    ensureOption(sub, long, flags, description, skip);
  }
}

// 已自定义同名选项的命令保留原语义（如 `config set --json` 是「按 JSON 解析输入 value」）
ensureOption(program, '--force', '-f, --force', '跳过确认');
ensureOption(program, '--debug', '-d, --debug', '输出调试信息');
ensureOption(program, '--json', '--json', 'JSON 格式输出（无 JSON 输出的命令接受但不生效）');
// --json-format 与 --json 成对出现，不逐命令手写；config set 除外（其 --json 是输入解析语义，无输出排版）
ensureOption(
  program,
  '--json-format',
  '--json-format',
  'JSON 输出时使用格式化（默认压缩）',
  (c) => c.name() === 'set' && c.parent?.name() === 'config',
);

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
