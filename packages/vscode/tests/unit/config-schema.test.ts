import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'vitest';
import {
  ALL_CONFIG_FIELDS,
  VSCODE_FIELDS,
  isKnownVscodeSetting,
  vscodeConfigKey,
} from '../../shared/config-schema';

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8'),
) as {
  contributes: {
    configuration: {
      properties: Record<string, unknown>;
    };
  };
};

test('每个 VS Code 设置都有配置页字段声明', () => {
  const declared = new Set(VSCODE_FIELDS.map((field) => field.key));
  const contributed = Object.keys(packageJson.contributes.configuration.properties).filter((key) =>
    key.startsWith('lattice.'),
  );
  for (const key of contributed) {
    assert.ok(declared.has(key), `missing config-schema field for ${key}`);
    assert.ok(isKnownVscodeSetting(key), `isKnownVscodeSetting rejected ${key}`);
  }
  for (const key of declared) {
    assert.ok(contributed.includes(key), `config-schema field not contributed: ${key}`);
  }
});

test('配置字段 key 唯一且可直接映射 WorkspaceConfiguration', () => {
  const keys = ALL_CONFIG_FIELDS.map((field) => `${field.store}:${field.key}`);
  assert.equal(new Set(keys).size, keys.length, 'duplicate config field');
  for (const field of VSCODE_FIELDS) {
    const relative = vscodeConfigKey(field.key);
    assert.ok(relative.length > 0);
    assert.ok(!relative.startsWith('lattice.'), `${field.key} produced ${relative}`);
  }
});

test('高风险字段必须显式标注影响', () => {
  const latticeHome = VSCODE_FIELDS.find((field) => field.key === 'lattice.latticeHome');
  assert.equal(latticeHome?.risk, 'high');
  assert.equal(latticeHome?.requiresReload, true);
  const model = ALL_CONFIG_FIELDS.find((field) => field.key === 'rag.embedding.modelId');
  assert.equal(model?.requiresRagRebuild, true);
});
