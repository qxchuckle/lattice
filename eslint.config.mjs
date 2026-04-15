import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
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
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      curly: 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
      semi: ['error', 'always'],
      'prefer-const': 'error',
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
