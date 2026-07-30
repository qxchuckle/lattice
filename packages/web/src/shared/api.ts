// packages/web/src/shared/api.ts

// ─── 错误码枚举（const 数组 + 字面量联合类型，零运行时依赖）───
export const API_ERROR_CODES = [
  'bad_request',
  'not_found',
  'forbidden',
  'conflict',
  'auth_not_enabled',
  'invalid_password',
  'unauthorized',
  'exec_failed',
  'internal',
  'unknown',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

// ─── 响应信封 ───
export interface ApiEnvelope<T = unknown> {
  code: ApiErrorCode | 'ok';
  message?: string;
  data?: T;
}

// ─── 客户端 ApiError（用于 client 端 envelope 解包后抛出）───
export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message?: string) {
    super(message ?? `API error: ${code}`);
    this.name = 'ApiError';
    this.code = code;
  }
}
