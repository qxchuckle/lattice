/**
 * JSON-RPC over stdio 客户端 — ACP 传输层
 *
 * 职责：spawn 子进程 + 换行分帧 + 请求/响应路由 + 通知分发 + 反向请求应答。
 * 不含业务语义（事件映射/能力翻译在 event-map / index）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { JsonRpcResponse, JsonRpcNotification, JsonRpcServerRequest } from './types.js';

export interface AcpTransportOptions {
  /** 启动命令（如 'qoder'） */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 请求超时（毫秒，默认 60s） */
  timeoutMs?: number;
}

type NotificationHandler = (msg: JsonRpcNotification) => void;
type ReverseRequestHandler = (msg: JsonRpcServerRequest) => Promise<unknown>;

export class AcpTransport {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (r: JsonRpcResponse) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private stdoutBuf = '';
  private notificationHandler: NotificationHandler | null = null;
  private reverseHandler: ReverseRequestHandler | null = null;
  private readonly timeoutMs: number;
  private exited = false;

  constructor(private readonly opts: AcpTransportOptions) {
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  /** 注册通知处理器（session/update 等） */
  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  /** 注册反向请求处理器（fs/*, session/request_permission 等） */
  onReverseRequest(handler: ReverseRequestHandler): void {
    this.reverseHandler = handler;
  }

  /** 启动子进程并绑定 stdio */
  start(): void {
    if (this.child) return;
    this.exited = false;
    const child = spawn(this.opts.command, this.opts.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.opts.cwd,
    });
    this.child = child;

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.onData(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', () => {
      /* stderr 静默（调试用途，不阻断） */
    });
    child.on('exit', () => {
      this.exited = true;
      // 敲定所有在途请求：reject（不挂到超时）
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`ACP 进程退出（command=${this.opts.command}），请求 ${id} 未完成`));
        this.pending.delete(id);
      }
    });
    child.on('error', (err) => {
      this.exited = true;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`ACP 进程启动失败：${err.message}`));
        this.pending.delete(id);
      }
    });
  }

  /** 发送请求并等待响应 */
  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.child || this.exited) {
      throw new Error(`ACP 进程未运行（command=${this.opts.command}）`);
    }
    const id = this.nextId++;
    const request = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    this.child.stdin?.write(request);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP 请求超时：${method}（${this.timeoutMs}ms）`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (resp: JsonRpcResponse) => {
          clearTimeout(timer);
          if (resp.error) {
            reject(new Error(`ACP 错误 [${resp.error.code}] ${resp.error.message}`));
          } else {
            resolve(resp.result as T);
          }
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });
    });
  }

  /** 发送通知（无需响应） */
  notify(method: string, params?: unknown): void {
    if (!this.child || this.exited) return;
    this.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  /** 终止子进程 */
  kill(): void {
    if (this.child && !this.exited) {
      this.child.kill('SIGTERM');
      // 宽限后强杀（unref 不阻止进程退出）
      const c = this.child;
      const t = setTimeout(() => {
        try {
          c.kill('SIGKILL');
        } catch {
          /* 已退出 */
        }
      }, 2000);
      t.unref?.();
    }
    this.child = null;
    this.exited = true;
  }

  get alive(): boolean {
    return !this.exited && this.child !== null;
  }

  // ── 内部 ──

  private onData(chunk: string): void {
    this.stdoutBuf += chunk;
    let idx: number;
    while ((idx = this.stdoutBuf.indexOf('\n')) >= 0) {
      const line = this.stdoutBuf.slice(0, idx).trim();
      this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // 非 JSON 行（调试输出等）
      }
      this.route(msg);
    }
  }

  private route(msg: Record<string, unknown>): void {
    const hasMethod = typeof msg.method === 'string';
    const hasId = msg.id !== undefined;

    if (hasMethod && hasId) {
      // agent → client 反向请求（需应答）
      void this.handleReverse(msg as unknown as JsonRpcServerRequest);
    } else if (hasMethod) {
      // 通知（session/update 等）
      this.notificationHandler?.(msg as unknown as JsonRpcNotification);
    } else if (hasId) {
      // 响应（对应我方 call）
      const pending = this.pending.get(msg.id as number);
      if (pending) {
        this.pending.delete(msg.id as number);
        pending.resolve(msg as unknown as JsonRpcResponse);
      }
    }
  }

  private async handleReverse(msg: JsonRpcServerRequest): Promise<void> {
    const reply = (result: unknown): void => {
      this.child?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
    };
    const fail = (code: number, message: string): void => {
      this.child?.stdin?.write(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code, message } }) + '\n',
      );
    };

    if (!this.reverseHandler) {
      fail(-32601, `no handler for ${msg.method}`);
      return;
    }
    try {
      const result = await this.reverseHandler(msg);
      reply(result);
    } catch (err) {
      fail(-32603, err instanceof Error ? err.message : String(err));
    }
  }
}
