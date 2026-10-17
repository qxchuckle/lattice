export type CliErrorCode =
  | 'CLI_NOT_FOUND'
  | 'CLI_SPAWN'
  | 'CLI_TIMEOUT'
  | 'CLI_CANCELED'
  | 'CLI_EXIT'
  | 'CLI_PARSE'
  | 'NO_PROJECT';

export interface CliErrorOptions {
  exitCode?: number;
  stderr?: string;
  args?: string[];
  cause?: unknown;
}

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly args?: string[];

  constructor(code: CliErrorCode, message: string, opts: CliErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
    this.args = opts.args;
  }

  /** stderr 摘要（截尾，供日志与用户提示）。 */
  get stderrSummary(): string {
    if (!this.stderr) return '';
    const trimmed = this.stderr.trim();
    return trimmed.length > 400 ? `…${trimmed.slice(-400)}` : trimmed;
  }
}

const NO_PROJECT_PATTERNS = [
  '当前目录不是 lattice 项目',
  '当前目录不是lattice项目',
  '不是一个 lattice 项目',
  'not a lattice project',
  'no lattice project',
];

/** 识别 CLI 的「当前目录不是 Lattice 项目」提示（转语义化 NO_PROJECT，不当作错误弹窗）。 */
export function isNoProjectOutput(text: string | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return NO_PROJECT_PATTERNS.some((p) => lower.includes(p));
}
