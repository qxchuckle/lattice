import { defineProject } from 'vitest/config';
import { sharedAliases } from '../../vitest.shared';

export default defineProject({
  // Vite 8 默认由 oxc 处理 .tsx（automatic JSX），无需 React 插件 / esbuild 覆盖
  resolve: { alias: sharedAliases },
  test: {
    name: 'web-ui',
    // 硬离线：测试环境禁用语义模型加载，避免下载/初始化模型拖慢或访问网络
    env: { LATTICE_DISABLE_SEMANTIC: '1' },
    environment: 'jsdom',
    // antd 表单/弹窗在 jsdom + v8 coverage 下渲染较慢，本地 <1s~4s 的用例 CI 满载
    // （六 projects 抢 CPU）可放大 5x+，逐条硬卡上限只会不停打地鼠。超时上限的作用是
    // 兜住真挂死/死循环，不是性能门槛，故整体放宽到 120s，不再对单条用例设更小的上限。
    testTimeout: 120000,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
