# 目录结构与配置

本文详细说明 Lattice 的数据目录结构和配置项，帮助你理解数据存储方式、进行备份迁移或自定义配置。

## 目录结构

Lattice 的所有数据都存储在 `~/.lattice/` 目录下。

> 可以通过环境变量 `LATTICE_HOME` 覆盖根目录位置（详见 [LATTICE_HOME 环境变量](#lattice_home-环境变量)）。

### 完整目录树

```
~/.lattice/                              # Lattice 根目录
├── config/                              # 配置文件
│   ├── config.json                      # 全局配置（可纳入 git 管理）
│   └── config-local.json                # 本机配置（已 gitignore，含用户名等）
├── spec/                                # 全局级 spec（所有用户、所有项目通用）
├── templates/                           # 模板目录
│   ├── spec/                            # spec 模板（frontend / backend / api 等）
│   └── registries/                      # 已拉取的远程模板仓库
├── models/                              # RAG embedding 模型文件
├── .cache/                              # 运行时缓存（已 gitignore）
│   ├── lattice.db                       # SQLite 数据库（项目/任务索引）
│   ├── lattice.db-wal                   # SQLite WAL 日志
│   ├── lattice.db-shm                   # SQLite 共享内存
│   ├── huggingface/                     # HuggingFace 模型下载缓存
│   ├── last-scan.json                   # 最近一次扫描的结果
│   └── web-server.json                  # Web 服务器运行状态
├── .trash/                              # 软删除回收站（删除的任务/项目暂存于此）
├── .git/                                # Git 仓库（可选，用于版本管理 ~/.lattice）
├── .gitignore                           # Git 忽略规则
└── users/                               # 用户数据
    └── <username>/                      # 按用户名隔离
        ├── spec/                        # 用户级 spec（跨项目复用）
        ├── projects/                    # 项目数据
        │   └── <project-id>/            # 单个项目（目录名为带前缀的完整 ID）
        │       ├── project.json         # 项目元数据（ID、名称、路径等）
        │       └── spec/                # 项目级 spec（仅当前项目有效）
        ├── tasks/                       # 任务数据
        │   └── <task-id>/               # 单个任务
        │       ├── task.json            # 任务元数据（状态、关联项目等）
        │       ├── prd.md               # 需求文档（目标、方案、文件索引）
        │       ├── progress.yaml        # 进度日志（checkpoint 记录）
        │       └── design.md            # 方案讨论档案（可选）
        └── relations.json               # 项目间关系记录
```

### 目录说明

| 目录/文件 | 用途 | 是否纳入 git |
|---|---|---|
| `config/config.json` | 全局配置（RAG 模型、模板仓库等） | 是 |
| `config/config-local.json` | 本机配置（用户名、扫描目录等） | 否（gitignore） |
| `spec/` | 全局级 spec，多用户多项目通用 | 是 |
| `templates/spec/` | spec 模板，`ltc spec template apply` 使用 | 是 |
| `templates/registries/` | `ltc spec template pull` 拉取的远程仓库 | 是 |
| `models/` | RAG embedding 模型文件 | 否（体积大） |
| `.cache/` | SQLite 数据库、模型缓存、运行状态 | 否（gitignore） |
| `.trash/` | 软删除回收站 | 否 |
| `users/<user>/spec/` | 用户级 spec，跨项目复用 | 是 |
| `users/<user>/projects/` | 项目注册数据 | 是 |
| `users/<user>/tasks/` | 任务数据 | 是 |
| `users/<user>/relations.json` | 项目间关系（fork / 依赖 / 共享组件等） | 是 |

### 分层说明

Lattice 的数据按以下层级组织：

- **根目录级**：配置、全局 spec、模板、模型、缓存——所有用户共享的基础设施
- **用户级**（`users/<username>/`）：按用户名隔离，包含该用户的 spec、项目、任务和关系数据
- **项目级**（`projects/<project-id>/`）：单个项目的元数据和项目级 spec
- **任务级**（`tasks/<task-id>/`）：单个任务的元数据、PRD、进度日志和方案讨论

### 项目根目录的 lattice.json

在每个已注册项目的根目录下，Lattice 会生成一个 `lattice.json` 文件：

```json
{
  "id": "f92c45e0d902f03b"
}
```

这个 `id` 是项目的 `legacy:` ID（优先级最高的身份标识）。Lattice 通过它以及 git 指纹（first commit SHA、git remotes）多重识别项目身份。

> `ltc link` 生成此文件；`ltc scan` 注册的 Git 项目不生成此文件（通过 git 指纹识别）。

## 配置

Lattice 的配置分为两个文件，位于 `~/.lattice/config/` 目录下：

| 文件 | 作用 | 是否纳入 git |
|---|---|---|
| `config.json` | 全局配置，可跨机器共享 | 是 |
| `config-local.json` | 本机配置，含用户名等机器相关信息 | 否（gitignore） |

两个文件合并后形成最终生效的配置：`config.json` 提供全局默认值，`config-local.json` 覆盖本机特定的值。

### 全局配置（config.json）

```json
{
  "version": "0.1.0",
  "rag": {
    "embedding": {
      "modelId": "Xenova/all-MiniLM-L6-v2",
      "remoteHost": "https://huggingface.co/",
      "remotePathTemplate": "{model}/resolve/{revision}/",
      "localModelPath": "~/.lattice/models",
      "cacheDir": "~/.lattice/.cache/huggingface",
      "allowRemoteModels": true,
      "allowLocalModels": true,
      "proxy": ""
    }
  }
}
```

配置项说明：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `version` | `"0.1.0"` | 配置文件版本号 |
| `registryTemplates` | — | 远程模板仓库 URL 列表 |
| `rag.embedding.modelId` | `Xenova/all-MiniLM-L6-v2` | RAG 搜索使用的 embedding 模型 |
| `rag.embedding.remoteHost` | `https://huggingface.co/` | 模型下载地址（可通过 `HF_ENDPOINT` 环境变量覆盖） |
| `rag.embedding.remotePathTemplate` | `{model}/resolve/{revision}/` | 远程模型路径模板 |
| `rag.embedding.localModelPath` | `~/.lattice/models` | 本地模型存储路径 |
| `rag.embedding.cacheDir` | `~/.lattice/.cache/huggingface` | 模型下载缓存目录 |
| `rag.embedding.allowRemoteModels` | `true` | 是否允许从远程下载模型 |
| `rag.embedding.allowLocalModels` | `true` | 是否允许使用本地模型 |
| `rag.embedding.proxy` | `""` | 下载模型时使用的代理地址 |

> 如果在大陆网络环境下载模型失败，可以设置 `rag.embedding.proxy` 或通过 `HF_ENDPOINT` 环境变量切换镜像。

### 本机配置（config-local.json）

```json
{
  "username": "myname",
  "gitEnabled": true,
  "scanDirs": [
    "~/projects",
    "~/work"
  ]
}
```

配置项说明：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `username` | — | 当前用户名（`ltc init` 时设置，必填） |
| `scanDirs` | — | `ltc scan` 默认扫描的目录列表 |
| `gitEnabled` | `true` | 是否对 `~/.lattice/` 启用 git 管理 |
| `gitRemote` | — | `~/.lattice/` git 仓库的远程地址 |
| `registryTemplates` | — | 本机级别的远程模板仓库 URL（覆盖全局） |

> `config-local.json` 在 `.gitignore` 中被忽略，不会提交到 git。切换机器时需要重新运行 `ltc init` 生成。

### LATTICE_HOME 环境变量

默认情况下，Lattice 使用 `~/.lattice/` 作为根目录。可以通过设置 `LATTICE_HOME` 环境变量来覆盖：

```bash
# 使用自定义目录
export LATTICE_HOME=/data/my-lattice

# 典型用途：测试 / CI / 多实例隔离
LATTICE_HOME=/tmp/test-lattice ltc init
```

> 设置 `LATTICE_HOME` 后，所有路径（config / spec / users / cache 等）都会基于该目录。

### 使用 ltc config 命令

```bash
# 查看完整配置（默认全局范围）
ltc config show

# 查看本机配置
ltc config show --scope local

# 仅显示与默认值不同的配置项
ltc config show --diff-defaults

# 读取单个配置项（点路径）
ltc config get rag.embedding.modelId

# 设置单个配置项
ltc config set rag.embedding.proxy "http://127.0.0.1:7890"

# 设置本机配置项
ltc config set scanDirs '["~/projects","~/work"]' --scope local

# 移除单个配置项
ltc config unset rag.embedding.proxy
```

`--scope` 参数：

- `global`（默认）：操作 `config.json`
- `local`：操作 `config-local.json`
