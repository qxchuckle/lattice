import type { FastifyInstance } from 'fastify';
import {
  readGlobalConfig,
  readLocalConfig,
  writeGlobalConfig,
  writeLocalConfig,
  getDefaultGlobalConfig,
  getDefaultLocalConfig,
  setByPath,
  deleteByPath,
  diffConfig,
} from '@qcqx/lattice-core';
import { ok, fail } from './shared';

/** 拒绝原型链污染路径 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSafeKey(key: string): boolean {
  return key.split('.').every((k) => !FORBIDDEN_KEYS.has(k));
}

export function registerConfigRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { scope?: string; diffDefaults?: string } }>(
    '/api/config',
    async (req) => {
      const scope = req.query.scope ?? 'global';
      if (scope === 'global') {
        const config = await readGlobalConfig();
        if (req.query.diffDefaults === 'true') {
          return ok(diffConfig(config, getDefaultGlobalConfig() as Record<string, unknown>));
        }
        return ok(config);
      }
      const config = await readLocalConfig();
      if (req.query.diffDefaults === 'true') {
        return ok(
          diffConfig(
            (config ?? {}) as Record<string, unknown>,
            getDefaultLocalConfig() as Record<string, unknown>,
          ),
        );
      }
      return ok(config);
    },
  );

  app.post<{ Body: { key: string; value: unknown; scope: string } }>(
    '/api/config/set',
    async (req) => {
      const { key, value, scope } = req.body;
      if (!key || !isSafeKey(key)) {
        return fail('bad_request', '无效的配置路径');
      }
      if (scope === 'global') {
        const config = await readGlobalConfig();
        setByPath(config, key, value);
        await writeGlobalConfig(config);
        return ok();
      }
      const config = (await readLocalConfig()) ?? { username: '' };
      setByPath(config, key, value);
      await writeLocalConfig(config);
      return ok();
    },
  );

  app.post<{ Body: { key: string; scope: string } }>('/api/config/unset', async (req) => {
    const { key, scope } = req.body;
    if (!key || !isSafeKey(key)) {
      return fail('bad_request', '无效的配置路径');
    }
    if (scope === 'global') {
      const config = await readGlobalConfig();
      deleteByPath(config, key);
      await writeGlobalConfig(config);
      return ok();
    }
    const config = (await readLocalConfig()) ?? { username: '' };
    deleteByPath(config, key);
    await writeLocalConfig(config);
    return ok();
  });
}
