# /lattice/project/profile

> **[执行前必读]** 执行本命令前必须先用 Skill 工具调用 `lattice` skill，再继续后续步骤。

**目标**：为项目生成/更新智能画像（summary.md + tags），支持增量更新。

## 命令参数

- 无参数 → 当前项目
- `--all` → 所有已注册项目
- `--project <id/name>` → 指定项目
- `--force` → 忽略缓存，强制全量重新生成

## 执行步骤

### 1. 检测哪些项目需要更新

```bash
ltc project profile check --json
# 或指定项目：
ltc project profile check --project <id> --json
```

- `--force` 时跳过检测，直接对所有目标项目执行更新
- 无 stale 项目且非 force → 输出"所有画像均为最新"并结束

### 2. 对每个 stale 项目，获取信息

**步骤 A：一条命令获取所有 lattice 内部信息**

```bash
ltc project profile brief <id>
```

输出包含：项目元数据、profile 目录路径、已有 summary.md 内容、已有 tags、项目级 spec 清单（ID/标题/摘要）、关联任务清单（ID/标题/状态）、项目关系。

**步骤 B：AI 自行读取文件系统信息**

- Git 日志（git 项目）：在 localPaths 下执行 `git log --oneline -30`
- 顶层目录结构：`ls` 各 localPath 一级
- README：读取根 README + 各 package 一级深度的 README
- package.json / Cargo.toml 等清单

**读取策略**：AI 自主决定读什么、读多深。增量更新时参考 brief 中的旧 summary，保留仍正确的内容。

### 3. 生成 summary.md

格式（功能/业务视角，不涉及代码结构和技术细节）：

```markdown
# <项目名>

<一句话定位：做什么、给谁用>

## 核心功能
- 功能/能力（业务视角描述）

## 包结构（仅 monorepo/多包项目）
- 各包的功能职责（业务视角，非技术实现）

## 生态角色
<在项目生态中的业务定位>
```

描述语言自适应（跟随用户对话和上下文）。

直接用文件编辑工具写入 `<profileDir>/summary.md`。

### 4. 设置标签

```bash
ltc project profile tags set <id> --tags "tag1,tag2,tag3"
```

标签为扁平字符串数组，描述项目的功能域、技术域、业务域。

### 5. 标记完成

```bash
ltc project profile done <id>
```

此命令自动：采集当前状态写入 cache.json + 同步 project.json profileUpdated + 触发 rag update。

### 6. 批量执行时输出统计

```
更新完成：3 个项目
  项目A — /path/to/a
  项目B — /path/to/b
  项目C — /path/to/c
跳过：57 个（无变化）
```

## 约束

- localPaths 不存在/为空时：跳过文件读取，仅用 lattice 内部数据（spec/任务/关系/元数据）生成
- 未提交的本地文件变更不管，只追踪已提交/已持久化的状态
- summary.md 不含：技术栈、目录结构、代码级细节
