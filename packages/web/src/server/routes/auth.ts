import type { FastifyInstance } from 'fastify';
import {
  isAuthEnabled,
  readWebAuth,
  writeWebAuth,
  clearWebAuth,
  hashPassword,
  verifyPassword,
  generateJwtSecret,
  type WebAuthConfig,
} from '@qcqx/lattice-core';
import { ok, fail } from './shared';
import { signJwt, TOKEN_EXPIRES_REMEMBER, TOKEN_EXPIRES_SESSION } from '../auth';

export function registerAuthRoutes(app: FastifyInstance): void {
  // 查询鉴权是否启用（白名单，免鉴权）
  app.get('/api/auth/status', async () => {
    const enabled = await isAuthEnabled();
    return ok({ enabled });
  });

  // 登录（白名单，免鉴权）
  app.post<{ Body: { password?: string; remember?: boolean } }>(
    '/api/auth/login',
    async (req, reply) => {
      const { password, remember } = req.body ?? {};
      const webAuth = await readWebAuth();
      if (!webAuth) {
        return fail('auth_not_enabled', '未配置密码，无需登录');
      }
      if (!password) {
        return fail('bad_request', '密码不能为空');
      }
      if (!verifyPassword(password, webAuth)) {
        return reply.code(401).send({ code: 'invalid_password', message: '密码错误' });
      }
      const expiresIn = remember ? TOKEN_EXPIRES_REMEMBER : TOKEN_EXPIRES_SESSION;
      const token = signJwt({}, webAuth.jwtSecret, expiresIn);
      return ok({ token, expiresIn });
    },
  );

  // 修改 / 设置 / 清除密码（受守卫，已登录用户无需旧密码）
  app.post<{ Body: { newPassword?: string } }>('/api/auth/password', async (req) => {
    const { newPassword } = req.body ?? {};
    const existing = await readWebAuth();

    // 清除密码（已登录用户可直接清除）
    if (!newPassword) {
      if (!existing) {
        return fail('auth_not_enabled', '未配置密码');
      }
      await clearWebAuth();
      return ok();
    }

    // 设置新密码
    if (newPassword.length < 4) {
      return fail('bad_request', '密码至少 4 位');
    }

    const { passwordHash, salt } = hashPassword(newPassword);
    const now = new Date().toISOString();
    const webAuth: WebAuthConfig = {
      passwordHash,
      salt,
      // 首次设置生成 jwtSecret；修改密码保留已有 jwtSecret（已签发 token 不失效）
      jwtSecret: existing?.jwtSecret ?? generateJwtSecret(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await writeWebAuth(webAuth);
    return ok();
  });

  // 登出（受守卫，JWT 无状态，客户端清除 token 即可）
  app.post('/api/auth/logout', async () => {
    return ok();
  });
}
