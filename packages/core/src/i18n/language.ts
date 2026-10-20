/**
 * 注入文档语言（skill / command / agent / rules）解析。
 *
 * `auto` 表示跟随系统 locale：`zh*` → 中文，其余 → 英文。
 * 具体支持的语言与默认语言由 `public/templates/languages.json` 声明；
 * 这里只保留纯函数，避免核心逻辑依赖模板文件系统。
 */

export type DocLanguage = 'zh' | 'en';

/** 用户可配置的语言设置；`auto` 表示按系统 locale 解析。 */
export type DocLanguageSetting = 'auto' | DocLanguage;

export const DOC_LANGUAGES: readonly DocLanguage[] = ['zh', 'en'];

export function isDocLanguage(value: unknown): value is DocLanguage {
  return value === 'zh' || value === 'en';
}

export function isDocLanguageSetting(value: unknown): value is DocLanguageSetting {
  return value === 'auto' || isDocLanguage(value);
}

/** 从 locale 环境变量 / Intl locale 判断系统语言；非中文一律回落英文。 */
export function detectLocaleLanguage(
  env: NodeJS.ProcessEnv = process.env,
  intlLocale?: string,
): DocLanguage {
  // POSIX locale 优先级：LC_ALL > LC_MESSAGES > LANG > LANGUAGE；只取首个生效值。
  const primary = env.LC_ALL || env.LC_MESSAGES || env.LANG || env.LANGUAGE;
  // Windows 等环境可能没有 LANG/LC_*，用 Intl 的运行时 locale 兜底。
  const locale = primary || intlLocale || getRuntimeLocale();
  return locale && /^zh(?:[_-]|$)/i.test(locale) ? 'zh' : 'en';
}

function getRuntimeLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

export interface ResolveDocLanguageOptions {
  /** 语言包声明的默认语言（languages.json 的 defaultLanguage）。 */
  defaultLanguage?: DocLanguage;
  /** 语言包声明的支持语言。 */
  supportedLanguages?: readonly DocLanguage[];
  env?: NodeJS.ProcessEnv;
  /** 测试或非 Node 环境可显式传入 Intl locale。 */
  intlLocale?: string;
}

/**
 * 把 `auto | zh | en | undefined` 解析为确定的注入语言。
 *
 * - 显式 zh/en 且被支持 → 直接使用；
 * - auto / 缺省 → 按 locale 解析（zh* → zh，其余 → en）；
 * - 非法值 → 回落 defaultLanguage（CLI 参数层应先行校验并报错）。
 */
export function resolveDocLanguage(
  setting: unknown,
  options: ResolveDocLanguageOptions = {},
): DocLanguage {
  const {
    defaultLanguage = 'zh',
    supportedLanguages = DOC_LANGUAGES,
    env = process.env,
    intlLocale,
  } = options;

  if (isDocLanguage(setting) && supportedLanguages.includes(setting)) {
    return setting;
  }

  // 非 auto 的未知值（如 fr、被语言包禁用的 en）按非法配置处理，回落默认语言。
  const isAuto = setting === undefined || setting === null || setting === '' || setting === 'auto';
  if (!isAuto) return defaultLanguage;

  const detected = detectLocaleLanguage(env, intlLocale);
  return supportedLanguages.includes(detected) ? detected : defaultLanguage;
}
