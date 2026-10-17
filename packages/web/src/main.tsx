/**
 * 浏览器宿主入口（薄壳）：挂载 @qcqx/lattice-web-ui 的浏览器 boot。
 * 真正的应用组装在 web-ui 包的 boot 入口（main.tsx），本文件仅作为 web 包的 vite 入口锚点。
 */
import '@qcqx/lattice-web-ui/boot';
