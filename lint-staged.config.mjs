export default {
  '**/*.{js,mjs,cjs,ts,mts,cts}': ['eslint --fix'],
  // 测试关卡：只跑与暂存源码相关的测试（lint-staged 会把文件路径追加为 related 的 filters）
  // --passWithNoTests：暂存文件没有关联测试时直接通过，不误伤
  '**/*.{ts,tsx,mts,cts}': ['vitest related --run --bail=1 --passWithNoTests'],
  '**/*': ['prettier --write --ignore-unknown'],
};
