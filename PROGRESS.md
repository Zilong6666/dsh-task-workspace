# DSH 任务工作区插件

> 任务目录：`按任务分文件夹与进度文件管理-插件-20261002/` · 唯一进度文件：本文件（每次修改后**覆盖更新**）

## 目标
把「任务工作区约定」（**一个会话只用一个文件夹**、一个任务一个覆盖式 PROGRESS.md、任务过长建 git）做成 DSH 插件 `dsh-task-workspace`，并上架 awesome-dsh-plugin 插件市场。

## 状态

进行中

## 当前进度

最新版 **0.3.0（一个会话只用一个文件夹）**，自测 **47 passed, 0 failed**。

- `src/store.mjs`：新增 `SESSION_MARKER = '.dsh-session.json'`、`readSessionMarker`、`writeSessionMarker({sessionId, root, name})`、`findTaskBySession(root, sessionId)`（先扫各任务目录的 marker，再回退查 `.dsh-tasks.json` 的 `sessionId`）、`ignoreSessionMarkerInGit`（写 `.git/info/exclude`，不改动被跟踪的 `.gitignore`）；`createTask({…, sessionId})` 命中本会话已有目录时直接复用，返回 `{created:false, reused:true}`，目录名保持不变；索引记录带 `sessionId`。
- `src/index.mjs`：`sessionIdFor(exec)`（`exec.agent.id` → sessionId/agent.session.id/meta.sessionId 兜底）；`task_new` 传 `sessionId` 并输出 `reused`，复用文案「本会话已有任务目录，已复用」；`conventionText()` 改为 5 条，第 1 条是「一个会话只用一个文件夹…需要改到别的文件夹时先给清单和理由征得同意」。
- `src/cli.mjs`：`dsh-task new` 支持 `--session <id>`。
- 文档同步：`skills/task-workspace/SKILL.md`、`README.md`、`README.zh.md`、`package.json` description、`marketplace/*.yml`、`marketplace/PUBLISH.md`；`README*.md` 自测数字 42 → 47。

## 上线进展（2026-10-02 ~ 10-03）

- GitHub 身份：实际账号 **`Zilong6666`**；仓库 https://github.com/Zilong6666/dsh-task-workspace （public、topic `dsh-plugin`、创建于 `2026-10-02T07:45:44Z`）。
- npm 账号 `grandparen`（tfa:false）；`npm publish` 被 2FA 拦截（`E403 … Two-factor authentication or granular access token with bypass 2fa enabled is required`）→ **放弃 npm 路径，改用 GitHub Release tarball**（市场条目加 `tarball:`）；用 bundled pnpm / npm 从 tarball URL 安装实测均通过（装出的包含 `dsh.bundle`、`src/tidy.mjs`、`skills/task-workspace/SKILL.md`）。
- 版本链：0.1.0 → 0.2.0（第 5 个工具 `task_tidy` + `src/tidy.mjs` + CLI `tidy`）→ 0.2.1（空目录改为只提示不删）→ **0.3.0（一个会话只用一个文件夹）**。
- 市场 PR 已开：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6480 （fork `Zilong6666/awesome-dsh-plugin`，分支 `add-dsh-task-workspace`，只新增 `data/plugins/Zilong6666__dsh-task-workspace.yml`）；状态 OPEN、mergeable，上游 Submission gate 已通过。**待办：把条目 tarball 更新到 v0.3.0 并推分支。**

## 下一步

- 发布 v0.3.0 Release（npm pack 产物作为资产），并把市场条目/PR 分支的 tarball 更新到 v0.3.0
- 重启 DSH 应用后本会话才会加载 0.3.0（当前进程内仍是 0.1.0；CLI 已可用）
- 等市场 PR #6480 合并

## 产出物

- PROGRESS.md
- package.json（0.3.0）
- cordis.patch.yml
- src/store.mjs（会话归属与复用）
- src/index.mjs（sessionIdFor / reused / conventionText 5 条）
- src/cli.mjs（`--session`）
- src/tidy.mjs（工作区整理）
- bin/dsh-task.mjs
- skills/task-workspace/SKILL.md
- test/run.mjs（47 项）
- README.md / README.zh.md
- LICENSE
- scripts/install-into-profile.sh
- scripts/append-bundle.mjs
- marketplace/data__plugins__Zilong6666__dsh-task-workspace.yml
- marketplace/PUBLISH.md

## 变更日志

| 时间 | 改动 |
| --- | --- |
| 2026-10-02 15:08 | 初始化任务目录与进度文件 |
| 2026-10-02 16:40 | 完成 store/index/cli 实现与测试框架；修复 git 参数顺序、显式 root、Markdown 空行三类 bug（29 passed） |
| 2026-10-02 17:20 | 写 README/README.zh/SKILL/LICENSE/市场条目；`dsh plugin --profile web add` 安装成功 |
| 2026-10-02 17:55 | 真机启动暴露 inject bug → `inject` 挂到 `apply` 属性；真机暴露 output.schema 的 `required` 用法 bug → 改对象级并加自测；新增 `scripts/install-into-profile.sh` + `append-bundle.mjs`（只改 bundles 数组）；自测 32 passed；真实 Cordis 容器验证 4 工具 + 1 段落 + 1 技能注册成功 |
| 2026-10-02 18:10 | 装进 desktop profile 并在本会话验证四个工具已可用；PUBLISH.md 发布指引 |
| 2026-10-02 15:45 | GitHub 登录完成，实际账号 `Zilong6666` → 全项目 owner 由 zlren 改为 Zilong6666；`gh repo create` 建库并推送，加 topic `dsh-plugin`；npm 登录完成（账号 `grandparen`），`npm publish` 被 2FA 拦截（E403） |
| 2026-10-02 16:05 | npm 2FA 路线受阻（无验证器；granular token 页面 Select organizations 空列表卡死）→ 改用 GitHub Release tarball：建 `v0.1.0` 资产、市场条目加 `tarball:`、bundled pnpm 实测从 URL 安装成功；fork 分支更新为 `20b6c0f` |
| 2026-10-02 15:50 | 修 `files` 缺 `skills`；删掉误建的两个空任务目录；fork awesome-dsh-plugin 并推分支 `add-dsh-task-workspace`（commit 8e5d01d），PR 待仓库满 1 天后开 |
| 2026-10-02 15:30（会话整理任务中发现） | 修第四个真机 bug：四个工具 `execute(args)` 未接 `exec`、`rootFor(args.workspace, undefined)`，cwd 永远解析不到而退回 `process.cwd()`；改 `execute(args, exec)`+`rootFor(..., exec)`，`cwdFor` 增加 workspaceRegistry → agents.get → 会话日志首帧三级回退，`isBlockedRoot` 拒绝 DSH_HOME/DSH_PROFILE_DIR 及其子目录；补 3 项回归测试，自测 **35 passed** |
| 2026-10-02 20:40 | 加第 5 个工具 `task_tidy` + `src/tidy.mjs` + CLI `tidy`，补 6 项测试（35→41），文档同步，版本 0.2.0 |
| 2026-10-02 21:30 | 修空目录误删：默认跳过空目录，仅在显式要求时删除；补 1 项测试（41→42）；文档同步；版本 0.2.1；发布 Release v0.2.0 / v0.2.1 |
| 2026-10-03 21:40 | **0.3.0「一个会话只用一个文件夹」**：`.dsh-session.json` 归属标记 + `findTaskBySession` + `createTask` 复用（`reused:true`）+ 索引 `sessionId` 兜底 + marker 排除出 git；`task_new` 输出 `reused`、提示词/SKILL/README 新增该规则与「跨文件夹改动须先征得同意」；CLI `--session`；补 5 项测试（42→47），全部通过 |
| 2026-10-03 21:50 | 同步工作区 `AGENTS.md`（新增第 0 条：一个会话只用一个文件夹）与 engram 记忆（偏好/决策/事实各 1 条） |


