/**
 * cytoscape 冒烟替身（仅本地冒烟构建使用，不进 VSIX）。
 * 冒烟 harness 用 SmokeGraph 占位组件替代真实画布，这里只保证模块可导入、
 * 且模块级 `cytoscape.use(...)` 调用不炸。
 */
const cytoscapeStub = (() => {
  const fn = () => {
    throw new Error('cytoscape is stubbed in the smoke harness');
  };
  (fn as unknown as { use: (extension: unknown) => void }).use = () => {};
  return fn;
})();

export default cytoscapeStub;
