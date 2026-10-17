import { theme as antdTheme, type ThemeConfig } from 'antd';

// ── 设计 token ──

export const tokens = {
  // 品牌色
  brandColor: '#1677FF',
  brandColorDark: '#4096FF',

  // 画布背景
  canvasBgLight: '#FEF9E7',
  canvasBgDark: '#32323C',

  // 中性色阶 - 浅色（偏柔和，不过于亮）
  light: {
    bg: '#F7F7F5',
    bgSecondary: '#F0F0EE',
    bgTertiary: '#E6E6E4',
    text: '#2A2A32',
    border: '#D8D8D6',
  },

  // 中性色阶 - 深色（偏柔和，不过于暗）
  dark: {
    bg: '#282830',
    bgSecondary: '#32323C',
    bgTertiary: '#3C3C48',
    text: '#EAEAF0',
    border: '#44444F',
  },

  // 实体配色
  entity: {
    task: '#1677FF',
    project: '#FA8C16',
    spec: '#13C2C2',
  },

  // 任务状态色
  taskStatus: {
    in_progress: '#1677FF',
    completed: '#52C41A',
    archived: '#8C8C8C',
    planning: '#FA8C16',
  },

  // 关系连线样式
  relationType: {
    'forked-from': { color: '#1677FF', style: 'solid' },
    'depends-on': { color: '#FA8C16', style: 'dashed' },
    'shares-component': { color: '#13C2C2', style: 'dotted' },
    'nested-in': { color: '#722ED1', style: 'solid' },
    related: { color: '#8C8C8C', style: 'solid' },
  } as Record<string, { color: string; style: 'solid' | 'dashed' | 'dotted' }>,

  // 过渡动画
  transition: {
    fast: '0.2s ease',
    normal: '0.3s ease',
    slow: '0.4s ease',
  },
} as const;

// ── antd 主题配置 ──

export function getAntdThemeConfig(mode: 'light' | 'dark'): ThemeConfig {
  const isDark = mode === 'dark';
  const t = isDark ? tokens.dark : tokens.light;

  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: isDark ? tokens.brandColorDark : tokens.brandColor,
      borderRadius: 8,
      fontSize: 14,
      colorBgContainer: t.bg,
      colorBgLayout: t.bg,
      colorText: t.text,
      colorBorder: t.border,
    },
    components: {
      Layout: {
        bodyBg: t.bg,
        headerBg: t.bg,
        siderBg: t.bgSecondary,
      },
      Menu: {
        itemBg: 'transparent',
      },
      Modal: {
        contentBg: t.bg,
        headerBg: t.bg,
        titleColor: t.text,
      },
      Drawer: {
        colorBgElevated: t.bg,
      },
    },
  };
}
