import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  detectLocaleLanguage,
  isDocLanguage,
  isDocLanguageSetting,
  resolveDocLanguage,
} from '../src/i18n/language';

test('detectLocaleLanguage：zh* 识别与优先级', () => {
  assert.equal(detectLocaleLanguage({ LANG: 'zh_CN.UTF-8' }), 'zh');
  assert.equal(detectLocaleLanguage({ LANG: 'zh-TW' }), 'zh');
  assert.equal(detectLocaleLanguage({ LANG: 'en_US.UTF-8' }), 'en');
  assert.equal(detectLocaleLanguage({}, 'en-US'), 'en');
  // GNU gettext：LANGUAGE > LC_ALL > LC_MESSAGES > LANG
  assert.equal(
    detectLocaleLanguage({ LC_ALL: 'en_US.UTF-8', LC_MESSAGES: 'zh_CN.UTF-8', LANG: 'zh_CN' }),
    'en',
  );
  assert.equal(detectLocaleLanguage({ LC_MESSAGES: 'zh_CN.UTF-8', LANG: 'en_US.UTF-8' }), 'zh');
  assert.equal(detectLocaleLanguage({ LANGUAGE: 'zh_CN:zh', LANG: 'en_US.UTF-8' }), 'zh');
  assert.equal(
    detectLocaleLanguage({ LC_MESSAGES: 'en_US.UTF-8', LANGUAGE: 'zh_CN:zh', LANG: 'zh_CN' }),
    'zh',
  );
  assert.equal(detectLocaleLanguage({ LANGUAGE: 'zh_CN:zh', LC_ALL: 'en_US.UTF-8' }), 'zh');
  // C/POSIX 下 LANGUAGE 被忽略
  assert.equal(detectLocaleLanguage({ LANGUAGE: 'zh_CN:zh', LC_ALL: 'C' }), 'en');
  assert.equal(detectLocaleLanguage({ LANGUAGE: 'zh_CN:zh', LANG: 'C.UTF-8' }), 'en');
  // Intl locale 兜底
  assert.equal(detectLocaleLanguage({}, 'zh-Hans-CN'), 'zh');
});

test('resolveDocLanguage：显式值 / auto / 非法值 / 不支持语言', () => {
  assert.equal(resolveDocLanguage('zh'), 'zh');
  assert.equal(resolveDocLanguage('en'), 'en');
  assert.equal(resolveDocLanguage('auto', { env: { LANG: 'zh_CN.UTF-8' } }), 'zh');
  assert.equal(resolveDocLanguage('auto', { env: { LANG: 'en_US.UTF-8' } }), 'en');
  assert.equal(resolveDocLanguage(undefined, { env: { LANG: 'zh_CN.UTF-8' } }), 'zh');
  assert.equal(resolveDocLanguage('fr', { defaultLanguage: 'zh' }), 'zh');
  assert.equal(
    resolveDocLanguage('en', { supportedLanguages: ['zh'], defaultLanguage: 'zh' }),
    'zh',
  );
});

test('isDocLanguage / isDocLanguageSetting', () => {
  assert.equal(isDocLanguage('zh'), true);
  assert.equal(isDocLanguage('en'), true);
  assert.equal(isDocLanguage('auto'), false);
  assert.equal(isDocLanguage(undefined), false);
  assert.equal(isDocLanguageSetting('auto'), true);
  assert.equal(isDocLanguageSetting('zh'), true);
  assert.equal(isDocLanguageSetting('fr'), false);
});
