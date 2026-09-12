import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tsconfigEslint from './tsconfig.eslint.json' with { type: 'json' };

export default defineConfig(
  pluginJs.configs.recommended,
  tseslint.configs.recommended,
  globalIgnores([...tsconfigEslint.exclude, '.temp-docs/**']),
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.{ts,mts,cts}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      curly: 'warn',
      // `always` 强制 ===，但豁免 `== null`/`!= null` 惯用法（同时判 null+undefined，是有意写法，改 === 会漏 undefined 分支）
      eqeqeq: ['warn', 'always', { null: 'ignore' }],
      'no-throw-literal': 'warn',
      semi: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // .tsx 与 .ts 一致容忍 unused vars（项目既有选择，见上方 .ts block）；
    // 单独 block 而非并入上方，避免把 type-aware 规则引入 .tsx 产生新报错。
    files: ['**/*.tsx'],
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  eslintPluginPrettierRecommended,
  {
    rules: {
      'prettier/prettier': 'warn',
      'no-control-regex': 'off',
    },
  },
);
