// packages/web/src/client/api/request.ts
import { ApiError } from '../../shared/api';
import type { ApiEnvelope, ApiErrorCode } from '../../shared/api';
import { authStore, clearToken } from '../store';

/** 获取 auth headers（从 authStore 读 JWT）*/
export function getAuthHeaders(): Record<string, string> {
  return authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {};
}

/** 清除 token 并触发登录重定向 */
function handleUnauthorized(): void {
  clearToken();
  window.dispatchEvent(new CustomEvent('auth:unauthorized'));
}

export interface RequestOptions extends RequestInit {
  /** 如果为 true，不自动解包 envelope，直接返回原始 Response（用于 SSE 等场景） */
  raw?: boolean;
}

/**
 * 统一请求核心
 * - 自动注入 auth header
 * - 401 拦截：clearToken + 触发 auth:unauthorized 事件
 * - envelope 解包：code !== 'ok' 时抛 ApiError
 * - AbortSignal 透传
 */
export async function request<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const { raw, headers: userHeaders, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    ...getAuthHeaders(),
    ...(userHeaders as Record<string, string>),
  };

  const response = await fetch(url, { ...fetchOptions, headers });

  // 401 拦截
  if (response.status === 401) {
    handleUnauthorized();
    let errBody: { code?: string; message?: string } | null = null;
    try {
      errBody = await response.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(
      (errBody?.code as ApiErrorCode) ?? 'unauthorized',
      errBody?.message ?? 'Unauthorized',
    );
  }

  // raw 模式（SSE 等场景需要原始 Response）
  if (raw) {
    return response as unknown as T;
  }

  // 非 200 系统错误
  if (!response.ok) {
    let errBody: { code?: string; message?: string } | null = null;
    try {
      errBody = await response.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(
      (errBody?.code as ApiErrorCode) ?? 'unknown',
      errBody?.message ?? `HTTP ${response.status}: ${response.statusText}`,
    );
  }

  // 解包 envelope
  const envelope: ApiEnvelope<T> = await response.json();

  if (envelope.code !== 'ok') {
    throw new ApiError(envelope.code as ApiErrorCode, envelope.message);
  }

  if (envelope.data === undefined) {
    return undefined as unknown as T;
  }
  return envelope.data as T;
}

/** GET 请求快捷方法 */
export function get<T = unknown>(url: string, options?: RequestOptions): Promise<T> {
  return request<T>(url, { ...options, method: 'GET' });
}

/** POST 请求快捷方法 */
export function post<T = unknown>(
  url: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>(url, {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string>),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** DELETE 请求快捷方法 */
export function del<T = unknown>(url: string, options?: RequestOptions): Promise<T> {
  return request<T>(url, { ...options, method: 'DELETE' });
}

/** PUT 请求快捷方法 */
export function put<T = unknown>(
  url: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>(url, {
    ...options,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string>),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
