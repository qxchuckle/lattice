# minimal-host — 三包宿主验收件

用 `@qcqx/lattice-agent-protocol` + `@qcqx/lattice-agent-source` + `@qcqx/lattice-agent-pipeline`
搭一个完整的 agent 宿主。宿主自己写的代码只有 [src/host.ts](./src/host.ts)（约 140 行），做两件事：

1. **会话簿记**：`threadId ↔ 源会话 ID`、fork 锚点
2. **呈现**：把事件流聚成文本 + 收集降级提示

其余全部白拿：

| 能力 | 谁提供 |
| --- | --- |
| SDK 适配（pi / qoder / ACP…） | agent-source 的 driver + `defineSource` 工厂 |
| 握手与能力核准（`ResolvedManifest`） | agent-source（`registry.initAll()`） |
| 能力差异消化（fork 锚点缺失 / 无压缩面 / 不可 append） | agent-pipeline 策略表 |
| slash 展开、skills 清单注入（源不支持时） | agent-pipeline polyfill middleware |
| 能力守卫（模型目录、权限模式、图片、工具注入） | agent-pipeline `capability-guard` |
| 反向权限问答（源问→宿主答） | agent-pipeline `createPermissionGate` → `PromptOpts.onPermissionRequest` |
| 节点操作能力投影（UI 与接口同一判定） | protocol `projectNodeCapabilities` |

权限闸门由谁传：`send()` 的 `opts` 直通源，宿主把编译好的裁决器放进去即可（默认拒绝，不默认放行）：

```ts
const decide = createPermissionGate({
  rules: [{ kind: 'terminal', decision: { behavior: 'deny', message: '本宿主不允许执行命令' } }],
  fallback: 'ask',
  ask: async (req) => askUserInUI(req), // 宿主自己的 UI
});
await host.send('t1', [{ type: 'text', text: '改一下配置' }], { onPermissionRequest: decide });
```

## 关键验收点

`src/host.ts` 里**没有任何一处按源 ID 分支的代码**（没有 `if (sourceId === 'pi')`）。
源之间的差异只体现为 `resolveSourceProfile()` 装配出的管线不同：

```
富能力源 → [normalize, capability-guard]
贫瘠源   → [normalize, tool-semantic, slash-expansion, skills-injection, capability-guard]
```

## 运行

```bash
pnpm --filter @qcqx/lattice-example-minimal-host check-types
pnpm vitest --project minimal-host
```

测试用 `@qcqx/lattice-agent-source/testing` 的脚本化 driver，不需要真实 SDK 与网络。
