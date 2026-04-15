# Spec 模板仓库结构说明

本文档说明 Lattice 如何从 Git 仓库拉取并导入自定义 spec 模板，以及模板仓库应该如何组织目录。

## 支持的命令

```bash
# 初始化时直接拉取模板仓库
lattice init --registry-template <git-url>

# 拉取一个新的模板仓库
lattice spec template pull <git-url>

# 同步已注册的模板仓库
lattice spec template sync

# 查看已注册的模板仓库
lattice spec template registry list

# 删除一个已注册的模板仓库
lattice spec template registry remove <git-url>
```

`lattice init --registry-template <git-url>` 会在初始化时拉取模板仓库，并将仓库地址写入全局配置 `~/.lattice/config/config.json` 的 `registryTemplates` 字段。

## 仓库目录结构约定

```text
my-spec-templates/
├── README.md
├── LICENSE
└── spec/
    ├── frontend/
    │   ├── template.json
    │   ├── index.md
    │   ├── component-guidelines.md
    │   └── state-management.md
    ├── backend/
    │   ├── template.json
    │   ├── index.md
    │   ├── layering.md
    │   └── database-guidelines.md
    └── mobile/
        ├── template.json
        ├── index.md
        └── navigation.md
```

- Lattice 会检测仓库中的 `spec/` 目录，并将其作为模板根目录，提取其中第一层文件夹作为模板名

## 单个模板目录应该怎么写

每个模板目录推荐长这样：

```text
frontend/
├── template.json
├── index.md
├── component-guidelines.md
├── directory-structure.md
├── hook-guidelines.md
├── quality-guidelines.md
├── state-management.md
└── type-safety.md
```

注意：

- 最外层 `frontend/` 是“模板名”
- 模板目录下所有 `*.md` 都会被递归导入
- 不需要再额外套一层同名目录

## `template.json` 规范

`template.json` 是可选文件，目前支持两个字段：

```json
{
  "description": "前端开发规范模板（适用于 React / Vue 项目）",
  "defaultScope": "user"
}
```

字段说明：

- `description`
  - 模板说明
  - 会展示在 `lattice spec template list` 中
- `defaultScope`
  - 可选值：`project`、`user`、`global`
  - 控制模板默认应用到哪一层

如果不提供：

- `description` 默认会退化成 `自定义模板 <模板名>`
- `defaultScope` 默认是 `project`

## Markdown 文件内容规范

每个 markdown 文件建议使用 frontmatter：

```md
---
title: 组件规范
tags: [frontend, components]
---

# 组件规范

## 组件职责

<!-- 这里写规范内容 -->
```

建议：

- 使用 `title`
- 使用 `tags`
- 一个文件聚焦一个主题
- 不要把多种无关规则塞进同一个 markdown

## 模板应用后的落地位置

### 如果模板默认是 `project`

会写入：

```text
~/.lattice/users/<username>/projects/<project-id>/spec/
```

例如：

```text
~/.lattice/users/alice/projects/p123/spec/frontend/index.md
~/.lattice/users/alice/projects/p123/spec/frontend/component-guidelines.md
```

### 如果模板默认是 `user`

会写入：

```text
~/.lattice/users/<username>/spec/
```

例如：

```text
~/.lattice/users/alice/spec/frontend/index.md
~/.lattice/users/alice/spec/frontend/component-guidelines.md
```

## 最佳实践

### 1. 用 `spec/` 作为仓库模板根目录

推荐使用：

```text
repo/spec/<template-name>/...
```

这样仓库更清晰，也方便以后扩展 README、示例和脚本。

### 2. 模板名稳定，不要频繁改名

模板名会直接成为用户使用的名字：

```bash
lattice spec template apply frontend
lattice link --template frontend,backend
```

所以模板名一旦发布，尽量保持稳定。

### 3. 一个模板一个主题域

建议：

- `frontend`
- `backend`
- `mobile`
- `observability`
- `security`

不建议：

- `all-in-one-enterprise-template`

### 4. 用多个小文件，而不是一个超大 markdown

推荐把模板拆成：

- `index.md`
- 专题子文档

这样更适合 AI 渐进式读取。
