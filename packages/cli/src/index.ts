import { Command } from 'commander';
import { basename, dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  runStartupSelfCheck,
  closeDb,
  readInitMeta,
  isInitialized,
  readLocalConfig,
  resolveDocLanguage,
  getDefaultDocLanguage,
} from '@qcqx/lattice-core';
import { resolveCurrentProject, logger, setMachineMode, applyLeafOptions } from './utils';
import { registerInitCommand } from './commands/init';
import { registerUninjectCommand } from './commands/uninject';
import { registerLinkCommand } from './commands/link';
import { registerUnlinkCommand } from './commands/unlink';
import { registerScanCommand } from './commands/scan';
import { registerProjectCommand } from './commands/project';
import { registerTaskCommand } from './commands/task';
import { registerSpecCommand } from './commands/spec';
import { registerExportCommand } from './commands/export';
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

program.name(cliName).description('Lattice — 本地优先的研发记忆与工作流层').version(pkg.version);

registerInitCommand(program);
registerUninjectCommand(program);
registerLinkCommand(program);
registerUnlinkCommand(program);
registerScanCommand(program);
registerProjectCommand(program);
registerTaskCommand(program);
registerSpecCommand(program);
registerExportCommand(program);
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

applyLeafOptions(program);

/* ─── 以 `-` 开头的自由文本位置参数 ─── */

/** 全部命令（含父命令）的选项 token；`=` 形态（`--message=…`）按前缀查 */
const knownOptionTokens = new Set<string>();
/** 需要值的选项 token：其后一个 token 是选项值，不得被当位置参数处理 */
const valuedOptionTokens = new Set<string>();

function collectOptionTokens(cmd: Command): void {
  for (const opt of cmd.options) {
    for (const token of [opt.long, opt.short]) {
      if (!token) continue;
      knownOptionTokens.add(token);
      if (opt.required || opt.optional) valuedOptionTokens.add(token);
    }
  }
  for (const sub of cmd.commands) collectOptionTokens(sub);
}
collectOptionTokens(program);

const PLACEHOLDER = '\u0000ph';
const maskedValues: string[] = [];

/**
 * 把「以 `-` 开头且含空格的位置参数」换成占位符，让 commander 不当选项解析——
 * 任务标题 / 搜索查询常以 `--json` 之类开头（`ltc task create "--json 输出瘦身"`），
 * 原样传会报 `error: unknown option '--json 输出瘦身'`，命令直接不执行。
 *
 * 四条判定同时满足才替换，缺一条宁可报错（失败方向安全）：
 * 1. **含空格**——合法选项名不含空格，故拼错的选项（`--jsonn`）仍报 unknown option 并带 Did you mean
 * 2. 不是已注册选项，也不是 `--opt=value` 形态（否则 `--message=--foo bar` 的值会被吃掉）
 * 3. 前一个 token 不是需要值的选项（否则 `-m '--foo bar'` 的值会被吃掉）
 * 4. 不在字面 `--` 之后（调用方已自行分隔）
 *
 * **不用 `passThroughOptions`，也不用「插一个 `--`」**：两者都会让位置参数**之后的真选项**
 * 退化为位置参数——实测 `ltc search q --json` 与 `ltc task create "--json 标题" --current -q`
 * 都报 too many arguments，破坏「`--json` 放末尾」的调用惯例（SKILL.md 要求每条命令都带）。
 *
 * 无解形态：值**恰好等于**某个已注册选项（`ltc search --json` 想搜字面量 `--json`）——
 * 无法与「传选项」区分，仍按选项解析，需要字面量时用 `--` 分隔。
 *
 * 不修改 `process.argv` 本身：命令文件里有 `process.argv.includes('--json')` 这类直读
 * （`config.ts` 的 `extractShowOptions`），改写数组副本即可，原地改会让直读拿到占位符。
 */
function maskDashLeadingValues(argv: string[]): string[] {
  let separated = false;
  return argv.map((token, i) => {
    if (token === '--') {
      separated = true;
      return token;
    }
    if (separated || !token.startsWith('-') || !token.includes(' ')) return token;
    const eq = token.indexOf('=');
    if (knownOptionTokens.has(token) || (eq > 0 && knownOptionTokens.has(token.slice(0, eq)))) {
      return token;
    }
    const prev = argv[i - 1];
    if (prev && valuedOptionTokens.has(prev.split('=')[0])) return token;
    maskedValues.push(token);
    return `${PLACEHOLDER}${maskedValues.length - 1}\u0000`;
  });
}

/** 还原占位符：位置参数与选项值都要覆盖（variadic 选项的值是数组） */
function restoreMasked(value: unknown): unknown {
  if (typeof value === 'string') {
    if (!value.startsWith(PLACEHOLDER)) return value;
    return maskedValues[Number(value.slice(PLACEHOLDER.length, -1))] ?? value;
  }
  if (Array.isArray(value)) return value.map(restoreMasked);
  return value;
}

async function main(): Promise<void> {
  // 进程退出时确保 DB 正确关闭（WAL checkpoint）
  process.on('exit', () => closeDb());

  // rag rebuild / rag update 本身会处理索引重建，跳过 startup-self-check 的提示
  // 使用 commander 的 preAction hook：在 action 执行前、命令解析后触发
  program.hook('preAction', async (_thisCommand, actionCommand) => {
    // 先还原被 mask 的位置参数与选项值，后续逻辑与 action 拿到的都是调用方原样传入的字符串
    if (maskedValues.length) {
      actionCommand.processedArgs = actionCommand.processedArgs.map((value) =>
        restoreMasked(value),
      );
      actionCommand.args = actionCommand.args.map((value) => restoreMasked(value) as string);
      for (const [key, value] of Object.entries(actionCommand.opts())) {
        const restored = restoreMasked(value);
        if (restored !== value) actionCommand.setOptionValue(key, restored);
      }
    }

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

    // init-meta 版本/语言检查：agent 文档是否过期（init 命令本身跳过；未初始化时跳过）
    if (name !== 'init') {
      try {
        if (await isInitialized()) {
          const meta = await readInitMeta();
          if (meta && meta.platforms.length === 0) {
            // 显式 uninject 后没有注入物，不应提示版本/语言过期
          } else if ((!meta || meta.version !== pkg.version) && !machineOutput) {
            console.warn('\x1b[33m⚠ lattice 注入已过期，运行 ltc init 更新\x1b[0m');
          } else if (meta && !machineOutput) {
            const localConfig = await readLocalConfig();
            const currentLanguage = resolveDocLanguage(localConfig?.language ?? 'auto', {
              defaultLanguage: getDefaultDocLanguage(),
            });
            if (meta.language !== currentLanguage) {
              console.warn(
                `\x1b[33m⚠ lattice 注入语言已变化（${meta.language ?? '未记录'} → ${currentLanguage}），运行 ltc init 更新\x1b[0m`,
              );
            }
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

  await program.parseAsync(maskDashLeadingValues(process.argv.slice(2)), { from: 'user' });
}

main().catch((error: unknown) => {
  // 顶层兜底：error 对象转 string 后经 logger.stderr 统一 home→~ 化（stack/message 可能含绝对路径）
  logger.stderr(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
