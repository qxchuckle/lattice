export default {
  '**/*.{js,mjs,cjs,ts,mts,cts}': ['eslint --fix'],
  '**/*.{ts,tsx,mts,cts}': ['vitest related --run --bail=1 --passWithNoTests'],
  '**/*': ['prettier --write --ignore-unknown'],
};
