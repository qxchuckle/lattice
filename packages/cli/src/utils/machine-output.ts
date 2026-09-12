import chalk from 'chalk';
import { logger } from './logger';

/**
 * machine 模式（`--json` / `-q`）的输出纯净度助手。
 *
 * 依据 cli-command-surface「输出流与 machine 模式约定」：stdout 只放机器可解析数据，
 * 提示性 / 诊断输出一律走 stderr。失败与空态提示若走 stdout，`$(...)` 与管道会捕到非数据
 * 字节（历史 bug：`spec template registry list` / `spec conflicts` / `spec template list`
 * 空态时 `--json` 吐人读文本；`task info` / `project info` 等未找到时同样泄漏且退出码为 0）。
 *
 * 模式标志由 `index.ts` 的 preAction hook 在命令解析后统一设置（那里已算出 machineOutput），
 * 因此各命令的提示点无需逐个透传 opts。
 */

let machineMode = false;

/** 由 preAction hook 调用：本次调用是否为 machine 输出模式（`--json` / `-q`） */
export function setMachineMode(on: boolean): void {
  machineMode = on;
}

export function isMachineMode(): boolean {
  return machineMode;
}

/**
 * 失败 / 未找到 / 参数非法类提示的统一出口：
 *
 * - machine 模式：提示走 **stderr** + 退出码 1，stdout 保持空；
 * - 人读模式：走 stdout（保持既有观感）。
 *
 * 调用方随后自行 `return`（本函数不改变控制流）。
 */
export function reportFailure(message: string): void {
  if (machineMode) {
    logger.stderr(chalk.yellow(message));
    process.exitCode = 1;
    return;
  }
  logger.raw(chalk.yellow(message));
}

/** 失败提示的次要补充行（用法/可选值等）：machine 模式同样走 stderr，但不改退出码 */
export function reportFailureHint(message: string): void {
  if (machineMode) {
    logger.stderr(chalk.dim(message));
    return;
  }
  logger.raw(chalk.dim(message));
}
