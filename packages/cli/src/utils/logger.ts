import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { format } from 'light-date';

// 当前活跃的 spinner
let activeSpinner: Ora | null = null;

/**
 * 获取当前时间戳字符串
 */
const getTimestamp = (): string => {
  const timestamp = format(new Date(), '{HH}:{mm}:{ss}.{SSS}');
  return chalk.gray(`[${timestamp}]`);
};

/**
 * 在有 spinner 时安全输出日志（带时间戳）
 */
const safeLog = (logFn: (...args: unknown[]) => void, ...args: unknown[]): void => {
  if (activeSpinner) {
    activeSpinner.clear();
    // logFn(getTimestamp(), ...args);
    logFn(...args);
    activeSpinner.render();
  } else {
    // logFn(getTimestamp(), ...args);
    logFn(...args);
  }
};

/**
 * 日志工具
 */
export const logger = {
  /**
   * 普通信息
   */
  info: (message: string, ...args: unknown[]): void => {
    safeLog(console.log, chalk.blue('info'), message, ...args);
  },

  /**
   * 成功信息
   */
  success: (message: string, ...args: unknown[]): void => {
    safeLog(console.log, chalk.green('success'), message, ...args);
  },

  /**
   * 警告信息
   */
  warn: (message: string, ...args: unknown[]): void => {
    safeLog(console.log, chalk.yellow('warn'), message, ...args);
  },

  /**
   * 错误信息
   */
  error: (message: string, ...args: unknown[]): void => {
    safeLog(console.error, chalk.red('error'), message, ...args);
  },

  /**
   * 调试信息
   */
  debug: (message: string, ...args: unknown[]): void => {
    safeLog(console.log, chalk.gray('debug'), message, ...args);
  },

  /**
   * 普通日志（无前缀）
   */
  log: (message: string, ...args: unknown[]): void => {
    safeLog(console.log, message, ...args);
  },

  /**
   * 原样输出，保持与 console.log 一致
   */
  raw: (...args: unknown[]): void => {
    safeLog(console.log, ...args);
  },

  /**
   * 包名高亮
   */
  pkg: (name: string, version?: string): string => {
    if (version) {
      return chalk.cyan(`${name}${chalk.gray('@')}${logger.version(version)}`);
    }
    return chalk.cyan(name);
  },

  /**
   * 版本号高亮
   */
  version: (version: string): string => {
    return chalk.magenta(version);
  },

  /**
   * 路径高亮
   */
  path: (path: string): string => {
    return chalk.gray(path);
  },

  /**
   * 命令高亮
   */
  cmd: (cmd: string): string => {
    return chalk.yellow(cmd);
  },

  /**
   * 格式化耗时
   */
  duration: (startTime: number): string => {
    const ms = Date.now() - startTime;
    if (ms < 1000) {
      return chalk.gray(`${ms}ms`);
    }
    const seconds = (ms / 1000).toFixed(2);
    return chalk.gray(`${seconds}s`);
  },

  /**
   * 创建并启动 spinner
   */
  spin: (text: string): Ora => {
    // 如果已有活跃的 spinner，先停止它
    if (activeSpinner) {
      activeSpinner.stop();
    }
    activeSpinner = ora({
      text,
      color: 'cyan',
    }).start();
    return activeSpinner;
  },

  /**
   * 停止当前 spinner 并显示成功
   */
  spinSuccess: (text?: string): void => {
    if (activeSpinner) {
      activeSpinner.succeed(text);
      activeSpinner = null;
    }
  },

  /**
   * 停止当前 spinner 并显示失败
   */
  spinFail: (text?: string): void => {
    if (activeSpinner) {
      activeSpinner.fail(text);
      activeSpinner = null;
    }
  },

  /**
   * 停止当前 spinner 并显示警告
   */
  spinWarn: (text?: string): void => {
    if (activeSpinner) {
      activeSpinner.warn(text);
      activeSpinner = null;
    }
  },

  /**
   * 停止当前 spinner 并显示信息
   */
  spinInfo: (text?: string): void => {
    if (activeSpinner) {
      activeSpinner.info(text);
      activeSpinner = null;
    }
  },

  /**
   * 更新 spinner 文本
   */
  spinText: (text: string): void => {
    if (activeSpinner) {
      activeSpinner.text = text;
    }
  },

  /**
   * 停止当前 spinner（无状态）
   */
  spinStop: (): void => {
    if (activeSpinner) {
      activeSpinner.stop();
      activeSpinner = null;
    }
  },

  /**
   * 启动当前 spinner
   */
  spinStart: (): void => {
    if (activeSpinner) {
      activeSpinner.start();
    }
  },

  /**
   * clear current spinner
   */
  spinClear: (): void => {
    if (activeSpinner) {
      activeSpinner.clear();
    }
  },
};

export default logger;
