# dsh-task-workspace

给 DSH 加一条落得下地的工程约定：**一个任务一个目录，一个任务一个进度文件（每次修改整体覆盖更新），任务过长就在任务目录里建 git 仓库。**

- 英文文档：[README.md](./README.md)
- 中文文档：本文件

## 它做什么

| 组成 | 效果 |
| --- | --- |
| 提示词段落 `task-workspace` | 每一轮对话都带着这条约定，任何工作区都生效 |
| 技能 `task-workspace-convention` | 同一份约定，可通过技能目录被检索到 |
| 工具 `task_new` | 建 `<工作区根>/<任务名>-<YYYYMMDD>/PROGRESS.md`（可选顺手 `git init`） |
| 工具 `task_progress` | 对那唯一的进度文件做整体覆盖更新；长摘要自动压缩；可选自动提交 |
| 工具 `task_git` | `git init` + `.gitignore` + 首次提交，或追加一次提交 |
| 工具 `task_list` | 列出当前工作区已有的任务目录 |
| 命令行 `dsh-task` | 不用模型也能执行同样的操作 |

## 安装

```bash
dsh plugin --profile desktop add dsh-task-workspace
```

本地目录安装：

```bash
dsh plugin --profile desktop add /绝对路径/dsh-task-workspace
```

装好后重启该 profile（或开新会话），bundle 补丁才会被合成。

## 落盘形态

```
<工作区根>/
├── .dsh-tasks.json              # 轻量任务索引，写入时更新
├── 竞品调研-20261002/
│   ├── PROGRESS.md              # 这个任务唯一的进度文件
│   ├── .git/                    # 只有「任务过长」时才有
│   └── data/…                   # 任务产出
└── etl-refactor-20261003/
    └── PROGRESS.md
```

`PROGRESS.md` 固定六段：目标 / 状态 / 当前进度 / 下一步 / 产出物 / 变更日志。

## 工具用法

### `task_new`

```jsonc
{ "name": "竞品调研", "goal": "整理三家竞品的定价与功能差异", "init_git": true }
```

- 建 `竞品调研-<当天日期>/` 及它的 `PROGRESS.md`；
- 同一天重复调用是幂等的，返回已有任务；
- `force: true` 可接管同名但非空目录；
- `slug` 可覆盖目录名。

### `task_progress`

```jsonc
{
  "task_dir": "竞品调研-20261002",          // 也可用 "task": "竞品"
  "summary": "已抓取 3 家官网定价页，A 家缺 API 价目",
  "changelog": "完成定价页抓取",
  "status": "进行中",
  "next": "补齐 A 家 API 价目\n输出对比表",
  "deliverables": "data/pricing.csv"
}
```

- **覆盖**「当前进度」而不是往里追加；摘要超过约 18 行会自动压成
  `### 进度历史（压缩摘要）` 加一个 `<details>` 折叠区保存原文，既不留垃圾也不丢历史；
- 「变更日志」只追加一行，不重写历史；
- 任务目录里已有仓库时自动提交（`commit: false` 可跳过，或把配置里的 `autoCommit` 设为 `false`）；
- 什么都不传会报错，避免无意义的空写入。

### `task_git`

```jsonc
{ "task_dir": "竞品调研-20261002", "message": "chore: 初始化任务仓库" }
```

初始化仓库并写入 `.gitignore`（`.DS_Store`、`__pycache__/`、`node_modules/`、`.venv/`、`*.tmp`）后提交；
再次调用就是提交当前状态。

### `task_list`

列出当前工作区的任务目录，含状态、最后更新时间、是否已建仓库。

## 命令行

```bash
dsh-task new "竞品调研" "整理定价差异" --git
dsh-task progress 竞品调研 --summary "抓到 3 家" --changelog "完成抓取"
dsh-task git 竞品调研 --message "chore: 初始化任务仓库"
dsh-task list
dsh-task config --root "/path/to/workspace"
```

退出码：`0` 正常，`1` 用法错误，`2` 操作失败。人读的信息走 stderr，结果路径走 stdout
（所以 `cd "$(dsh-task new …)"` 可以直接用）。

## 配置

工作区根的解析顺序：工具参数 → 配置 `workspaceRoot` → `$DSH_TASK_WORKSPACE_ROOT` →
`$DSH_WORKSPACE_ROOT` → 会话工作区目录 → `$DSH_HOME`。
显式指定的根目录不存在时会自动创建；`node_modules/`、`/`、临时目录、`$HOME` 本身会被拒绝。

配置文件位于 `${DSH_HOME}/dsh-task-workspace/config.json`：

```json
{
  "enabled": true,
  "workspaceRoot": "",
  "defaultGit": false,
  "autoCommit": true,
  "sectionOrder": 61,
  "promptEnabled": true,
  "skillEnabled": true,
  "template": "",
  "gitAuthor": { "name": "", "email": "" }
}
```

- `defaultGit: true`：所有新任务默认建仓库；
- `promptEnabled: false` / `skillEnabled: false`：保留工具，但不注入提示词/技能；
- `template`：直接内联 `PROGRESS.md` 的 markdown 模板；
- `gitAuthor`：给没有全局 git 身份、也没有 `~/.gitconfig` 的机器兜底
  （也可以用环境变量 `$DSH_TASK_GIT_NAME` / `$DSH_TASK_GIT_EMAIL`）。

profile 也可以在自己的补丁层覆盖同样的键：

```yaml
- id: task-workspace
  name: 'dsh-task-workspace'
  config:
    workspaceRoot: /Users/me/notes
    defaultGit: true
```

## 什么时候该建仓库

约定给的触发条件很明确，满足任一即建：

- 预计超过 3 轮对话；
- 需要跨会话继续；
- 预计产出文件超过 10 个；
- 用户明确要求。

## 开发与自测

```bash
node test/run.mjs          # 32 项：store、工具、真实 git、CLI、宿主 JSON Schema 子集，不联网
node test/run.mjs --keep   # 保留临时工作区便于检查
```

## 许可证

MIT

## 被应用独占的 profile

`dsh plugin --profile desktop add …` 会因为 desktop profile 归属 Electron 应用而拒绝执行。
`scripts/install-into-profile.sh` 只做那条命令本来会做的两件事：

```bash
bash scripts/install-into-profile.sh desktop --dry-run   # 先看计划
bash scripts/install-into-profile.sh desktop             # 建链接 + 写入 bundles
```

它把包链接进 `<profile>/node_modules`，并把包名追加到 `dsh.profile.bundles`；
只就地修改这个数组，`package.json` 其余字节保持不变（这个文件由应用自己重写）。
首次改动前会备份 `package.json.bak`。装完重启该 profile。

## 两个只有真机启动才暴露的坑

（本插件已修好，这里记下来供二次开发参考）

- **`inject` 必须挂在导出值上。** `cordis-plugin-loader` 用 `exports.default ?? exports`
  归一化模块形状，所以只要模块有 default 导出，命名导出的 `inject` 就会被丢掉，报
  `Error: cannot get property "systemPrompt" without inject`。正确写法是挂到函数属性：
  `apply.inject = ['tools', 'systemPrompt']`。
- **`required` 是对象级关键字。** 宿主会校验工具输出 schema 是否落在它自己的 JSON Schema
  子集内（`type/oneOf/properties/required/additionalProperties/items/enum/const` 加注解），
  在标量属性上写 `required: true` 会报
  `JsonSchemaError: schema.properties.x.required is not supported on type "string"`。
  要写在对象上：`{ type: 'object', required: ['dir'], properties: { dir: { type: 'string' } } }`。
