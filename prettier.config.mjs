// @ts-check
import { defineConfig } from '@archoleat/prettier-define-config';

export default defineConfig({
  arrowParens: 'always',
  bracketSameLine: true,
  bracketSpacing: true,
  semi: true,
  experimentalTernaries: false,
  singleQuote: true,
  jsxSingleQuote: true,
  quoteProps: 'preserve',
  trailingComma: 'all',
  singleAttributePerLine: false,
  htmlWhitespaceSensitivity: 'css',
  vueIndentScriptAndStyle: false,
  proseWrap: 'never',
  insertPragma: false,
  printWidth: 100,
  requirePragma: false,
  useTabs: false,
  embeddedLanguageFormatting: 'auto',
  tabWidth: 2,
  endOfLine: 'auto',
});
