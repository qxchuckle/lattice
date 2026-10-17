/**
 * @ant-design/icons 冒烟入口替换：根导出在 SSR/node 条件下解析到 index.mjs
 * （`import _mod from './lib/index.js'; export default _mod.default ?? _mod;`），
 * 该文件依赖 Node 原生 CJS 默认互操作，被 Vite SSR 打包后 `_mod` 绑定丢失（ReferenceError）。
 * 这里改指向纯 ESM 的 es 目录入口，绕开 node 条件分支。
 */
export * from '@ant-design/icons/es';
export { default } from '@ant-design/icons/es';
