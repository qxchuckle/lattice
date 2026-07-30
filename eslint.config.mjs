import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import rxjsX from 'eslint-plugin-rxjs-x';
import tsconfigEslint from './tsconfig.eslint.json' with { type: 'json' };

export default defineConfig(
  pluginJs.configs.recommended,
  tseslint.configs.recommended,
  globalIgnores(tsconfigEslint.exclude),
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
      // 未用声明必报（代码删改后的残留导入/变量会静默积累）；故意保留的用 `_` 前缀豁免
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unused-expressions': 'off',
      curly: 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
      semi: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  // RxJS 订阅防卫（需类型信息，仅限上方已配 parserOptions.project 的 ts 文件）：
  // no-exposed-subjects — 禁止对外暴露可写 Subject（外部 next() 会篡改状态机）
  // no-ignored-subscription — 禁止丢弃 subscribe 返回的 Subscription（无句柄则无法退订，泄漏源头）
  {
    files: ['**/*.{ts,mts,cts}'],
    plugins: { 'rxjs-x': rxjsX },
    rules: {
      'rxjs-x/no-exposed-subjects': 'warn',
      'rxjs-x/no-ignored-subscription': 'warn',
    },
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
