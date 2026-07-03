import { theme as antdTheme, type ThemeConfig } from 'antd';

// ── 设计 token ──

export const tokens = {
  // 品牌色
  brandColor: '#1677FF',
  brandColorDark: '#4096FF',

  // 画布背景
  canvasBgLight: '#FEF9E7',
  canvasBgDark: '#25252E',

  // 中性色阶 - 浅色
  light: {
    bg: '#FFFFFF',
    bgSecondary: '#FAFAFA',
    bgTertiary: '#F0F0F0',
    text: '#1D1D26',
    border: '#E8E8E8',
  },

  // 中性色阶 - 深色
  dark: {
    bg: '#1D1D26',
    bgSecondary: '#25252E',
    bgTertiary: '#2D2D38',
    text: '#E8E8E8',
    border: '#3D3D48',
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
    },
  };
}
