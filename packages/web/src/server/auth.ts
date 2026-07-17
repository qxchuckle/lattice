import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { isAuthEnabled, readWebAuth } from '@qcqx/lattice-core';

// ─── JWT HS256 手写实现（不引入 jsonwebtoken 依赖）───

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

const JWT_HEADER_B64 = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export interface JwtPayload {
  iat: number;
  exp: number;
  [key: string]: unknown;
}

/** 签发 JWT HS256 */
export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSec: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = { ...payload, iat: now, exp: now + expiresInSec };
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const data = `${JWT_HEADER_B64}.${payloadB64}`;
  const signature = createHmac('sha256', secret).update(data).digest();
  return `${data}.${base64url(signature)}`;
}

/** 校验 JWT HS256，返回 payload；无效或过期返回 null */
export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac('sha256', secret).update(data).digest();
  let actualSig: Buffer;
  try {
    actualSig = base64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (expectedSig.length !== actualSig.length) return null;
  if (!timingSafeEqual(expectedSig, actualSig)) return null;
  try {
    const payload = JSON.parse(base64urlDecode(payloadB64).toString()) as JwtPayload;
    if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── token 有效期 ───

/** 记住登录：30 天 */
export const TOKEN_EXPIRES_REMEMBER = 30 * 24 * 60 * 60;
/** 不记住：1 天 */
export const TOKEN_EXPIRES_SESSION = 24 * 60 * 60;

// ─── 守卫白名单 ───

const WHITELIST_PATHS = new Set(['/api/auth/login', '/api/auth/status']);

// ─── token 提取 ───

/** 从请求中提取 token：优先 Authorization: Bearer，其次 query ?token=（WebSocket 握手用） */
export function extractToken(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  // WebSocket 握手无法设置 Header，通过 query 传 token
  const url = new URL(req.url, 'http://localhost');
  const queryToken = url.searchParams.get('token');
  return queryToken;
}

// ─── onRequest 守卫 hook ───

/**
 * Fastify onRequest 守卫：
 * 1. 白名单路径放行
 * 2. 非 /api 请求放行（静态资源、SPA fallback）
 * 3. 未配置密码放行（向后兼容）
 * 4. 有密码则校验 JWT token，无效返回 401
 */
export async function authGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const path = req.url.split('?')[0];

  // 白名单放行
  if (WHITELIST_PATHS.has(path)) return;

  // 非 /api 请求放行（静态资源、SPA fallback）
  if (!path.startsWith('/api')) return;

  // 未配置密码放行
  const enabled = await isAuthEnabled();
  if (!enabled) return;

  const webAuth = await readWebAuth();
  if (!webAuth) return;

  const token = extractToken(req);
  if (!token) {
    reply.code(401).send({ error: 'unauthorized', message: '未登录或 token 缺失' });
    return;
  }

  const payload = verifyJwt(token, webAuth.jwtSecret);
  if (!payload) {
    reply.code(401).send({ error: 'unauthorized', message: 'token 无效或已过期' });
    return;
  }
}
