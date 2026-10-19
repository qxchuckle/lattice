export default {
  '**/*.{js,mjs,cjs,ts,mts,cts}': ['eslint --fix'],
  '**/*.{ts,tsx,mts,cts}': [
    // cli E2E 依赖构建产物（dist），pre-commit 环境不保证新鲜，排除在 related 之外
    "vitest related --run --bail=1 --passWithNoTests --exclude 'packages/cli/tests/e2e/**'",
  ],
  '**/*': ['prettier --write --ignore-unknown'],
};
