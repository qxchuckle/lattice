export default {
  '**/*.{js,mjs,cjs,ts,mts,cts}': ['eslint --fix'],
  '**/*': ['prettier --write --ignore-unknown'],
};
