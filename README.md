# dsh-task-workspace

给 DSH 加一条落得下地的工程约定：**一个任务一个目录，一个任务一个进度文件（每次修改整体覆盖更新），任务过长就在任务目录里建 git 仓库。**

A DSH bundle that makes one convention stick: **one folder per task, exactly one progress file per task (overwritten on every update), and per-task git once the task runs long.**

- 中文文档：[README.zh.md](./README.zh.md)
- English docs: this file

## What it does

| Piece | Effect |
| --- | --- |
| Prompt section `task-workspace` | The convention is present in every turn, always, in every workspace |
| Skill `task-workspace-convention` | The same convention, discoverable through the skill catalog |
| Tool `task_new` | Creates `<workspace>/<name>-<YYYYMMDD>/PROGRESS.md` (optionally `git init`) |
| Tool `task_progress` | Whole-file overwrite of that one progress file; auto-compacts long summaries; optionally commits |
| Tool `task_git` | `git init` + `.gitignore` + first commit, or a follow-up commit |
| Tool `task_list` | What task folders already exist in this workspace |
| Tool `task_tidy` | Classifies every top-level entry, rewrites the workspace index, and clears OS litter / caches / stale backups / empty folders / stray task folders (dry run unless `apply: true`) |
| CLI `dsh-task` | The same operation without a model |

## Install

```bash
# from a profile (web / desktop / cli …)
dsh plugin --profile desktop add dsh-task-workspace
```

Or install from a local checkout:

```bash
dsh plugin --profile desktop add /absolute/path/to/dsh-task-workspace
```

Then restart the profile (or start a new session) so the bundle patch is composed.

## The on-disk shape

```
<workspace>/
├── .dsh-tasks.json              # small task index, rebuilt/updated on write
├── 竞品调研-20261002/
│   ├── PROGRESS.md              # the ONLY progress file of this task
│   ├── .git/                    # only when the task ran long
│   └── data/…                   # task output
└── etl-refactor-20261003/
    └── PROGRESS.md
```

`PROGRESS.md` always has the same six sections: 目标 / 状态 / 当前进度 / 下一步 / 产出物 / 变更日志
(goal / status / current progress / next steps / deliverables / changelog).

## Tools

### `task_new`

```jsonc
{ "name": "竞品调研", "goal": "整理三家竞品的定价与功能差异", "init_git": true }
```

- Creates `竞品调研-<today>/` and its `PROGRESS.md`.
- Idempotent for the same day: calling it again returns the existing task.
- `force: true` adopts an existing non-empty folder of the same name.
- `slug` overrides the folder slug.

### `task_progress`

```jsonc
{
  "task_dir": "竞品调研-20261002",          // or "task": "竞品"
  "summary": "已抓取 3 家官网定价页，A 家缺 API 价目",
  "changelog": "完成定价页抓取",
  "status": "进行中",
  "next": "补齐 A 家 API 价目\n输出对比表",
  "deliverables": "data/pricing.csv"
}
```

- **Overwrites** the `当前进度` section instead of appending to it. A summary longer
  than ~18 lines is automatically compacted into a `### 进度历史（压缩摘要）` block plus a
  collapsible `<details>` archive, so nothing is lost and the file stays readable.
- Appends one line to `变更日志` (history is never rewritten).
- Commits inside the task repository when one exists (`commit: false` to skip,
  or set `autoCommit: false` in the config).
- Passing nothing is an error, so the file never gets a meaningless touch.

### `task_git`

```jsonc
{ "task_dir": "竞品调研-20261002", "message": "chore: 初始化任务仓库" }
```

Initializes the repository with a `.gitignore` (`.DS_Store`, `__pycache__/`, `node_modules/`,
`.venv/`, `*.tmp`) and commits; a second call just commits the current state.

### `task_list`

Lists the task folders of the current workspace with status, last update time and
whether the task has its own repository.

### `task_tidy`

Tidies the workspace the convention created it in:

- classifies every top-level entry as 任务 / 产出 / 中间产物 / 工具 / 配置 / 散落文件;
- rewrites the index file (`工作区索引.md` by default) — a table per category with
  size, file count, last change, task status and goal;
- reports the heavy intermediate folders (over 200 MB) without touching them;
- **dry run unless `apply: true`**, and even then it only removes provably
  disposable things: `.DS_Store` and friends, `__pycache__` / `.pytest_cache`,
  `*.pyc` / `*.bak` / `*.orig` / `*.tmp` / `*.tgz`, and a
  task folder that landed outside the workspace holding nothing but its own
  `PROGRESS.md` (the "wrong cwd" accident) — never task content, never a README.
- empty folders are listed but **not** deleted (an empty `parts/` may be a
  placeholder a build script expects); pass `empty_dirs: true` to remove them too.

```jsonc
{ "workspace": "/path/to/workspace", "apply": true, "index": true, "empty_dirs": false }
```

> The index is regenerated on every run and is meant to be read, not edited.

## CLI

```bash
dsh-task new "竞品调研" "整理定价差异" --git
dsh-task progress 竞品调研 --summary "抓到 3 家" --changelog "完成抓取"
dsh-task git 竞品调研 --message "chore: 初始化任务仓库"
dsh-task list
dsh-task config --root "/path/to/workspace"
```

Exit codes: `0` ok, `1` usage error, `2` operation failed. Human-readable output goes to
stderr, the resulting path to stdout (so `cd "$(dsh-task new …)"` works).

## Configuration

Resolution order for the workspace root: tool argument → config `workspaceRoot` →
`$DSH_TASK_WORKSPACE_ROOT` → `$DSH_WORKSPACE_ROOT` → the session's workspace directory →
`$DSH_HOME`. An explicit root is created when missing; `node_modules/`, `/`, the temp
directory and `$HOME` itself are refused.

The config file lives at `${DSH_HOME}/dsh-task-workspace/config.json`:

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

- `defaultGit: true` — every new task gets a repository right away.
- `promptEnabled: false` / `skillEnabled: false` — keep the tools, drop the injected text.
- `template` — path-free inline markdown template for `PROGRESS.md`.
- `gitAuthor` — identity used for `git -c user.name=… -c user.email=…`, for machines with
  no global git identity (`$DSH_TASK_GIT_NAME` / `$DSH_TASK_GIT_EMAIL` also work).

A profile can override the same keys through its own patch layer:

```yaml
- id: task-workspace
  name: 'dsh-task-workspace'
  config:
    workspaceRoot: /Users/me/notes
    defaultGit: true
```

## When to create a repository

The convention's trigger is deliberately explicit — any one of:

- more than ~3 turns expected,
- must continue across sessions,
- more than ~10 produced files,
- the user asks for it.

## Development

```bash
node test/run.mjs          # 42 checks: store, tools, real git, CLI, host JSON Schema subset, session-cwd guards — no network
node test/run.mjs --keep   # keep the temporary workspace for inspection
```

## License

MIT

## Profiles owned by another application

`dsh plugin --profile desktop add …` refuses to run because the Electron app owns that
profile. `scripts/install-into-profile.sh` does the two things that command would have
done, and nothing else:

```bash
bash scripts/install-into-profile.sh desktop --dry-run   # show the plan
bash scripts/install-into-profile.sh desktop             # link + append to bundles
```

It links the package into `<profile>/node_modules` and appends the package name to
`dsh.profile.bundles`, editing only that array in place so the rest of `package.json`
stays byte-identical (the app rewrites that file itself). A `package.json.bak` is written
before the first change. Restart the profile afterwards.

## Runtime gotchas this plugin already handles

Both were only visible on a real boot, not in a stubbed unit test — worth knowing if you
fork this plugin:

- **`inject` must hang off the exported value.** `cordis-plugin-loader` normalizes module
  shapes with `exports.default ?? exports`, so a namespace-level `inject` export is dropped
  as soon as the module has a default export. A bare `export const inject = […]` next to
  `export default apply` gives you
  `Error: cannot get property "systemPrompt" without inject`. Attach it to the function:
  `apply.inject = ['tools', 'systemPrompt']`.
- **`required` is an object-level keyword.** The host validates tool output schemas against
  its own JSON Schema subset (`type/oneOf/properties/required/additionalProperties/items/enum/const`
  plus annotations) and rejects `required: true` on a scalar property with
  `JsonSchemaError: schema.properties.x.required is not supported on type "string"`.
  Put the list on the object: `{ type: 'object', required: ['dir'], properties: { dir: { type: 'string' } } }`.
