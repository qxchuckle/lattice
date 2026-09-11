# CLI 命令参数参考

查阅式字典路由。按命令类别转对应子文档；不知该调哪个命令 → 读流程文档（[task-workflows.md] / [spec-workflows.md] / [project-context.md] / [project-discovery.md]）。

## 通用约定

`-f, --force` 跳过二次确认。AI 调用以下命令**必须**加 `-f`/`--force`：

| 命令 | 确认内容 |
|---|---|
| `ltc init` | 是否下载 embedding 模型 |
| `ltc uninject` | 清除注入（删目录/文件、移除标记块） |
| `ltc unlink` | 取消项目注册 |
| `ltc project remove <id>` | 删除项目数据 |
| `ltc project relation remove <a> <b>` | 删除项目关系 |
| `ltc task delete <id>` | 彻底删除任务 |
| `ltc user remove <name>` | 删除用户 |
| `ltc fast-start log clear` | 清空日志 |

`--json`：所有叶子命令均接受；无 JSON 输出的命令接受但不生效（输出保持人读格式）。例外：`config set --json` 语义为将输入 value 按 JSON 解析，非输出格式控制（见 [cli-system.md#ltc-config]）。

## 命令分类路由

通用约定（`--force`/`--json`）适用于全部命令。按类别读参数字典：

| 类别 | 涵盖命令 | 参数字典 |
|---|---|---|
| 上下文与检索 | `status` / `context` / `search` | [cli-context-search.md] |
| 项目管理 | `project`（含 relation / profile）/ `link` / `unlink` / `scan` | [cli-project.md] |
| 任务生命周期 | `task`（含 checkpoint / progress / associate / ref-spec）/ `fast-start` | [cli-task.md] |
| 规范管理 | `spec`（含 list / show / set / lint / migrate / export）/ `spec template` | [cli-spec.md] |
| 同步与多用户 | `sync`（含 domain）/ `user` | [cli-sync-user.md] |
| 安装与系统维护 | `init` / `uninject` / `config` / `doctor` / `rag` / `trash` / `web` | [cli-system.md] |
