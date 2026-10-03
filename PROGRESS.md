# DSH 任务工作区插件

> 任务目录：`dsh-task-workspace-20261002/` · 唯一进度文件：本文件（每次修改后**覆盖更新**）

## 目标
把「任务工作区约定」（一个任务一个目录、一个任务一个覆盖式 PROGRESS.md、任务过长建 git）做成 DSH 插件 `dsh-task-workspace`，并上架 awesome-dsh-plugin 插件市场。

## 状态

进行中

## 当前进度

0.2.1：空目录改为只提示不删除（applyCleanup 新增 emptyDirs 选项，工具参数 empty_dirs / CLI --empty-dirs）；c819/source/parts 与 nsca568-build/parts/_frag-patterns1 曾被 0.2.0 当空目录删掉，已 mkdir 恢复。自测 42 项。
## 上线进展（2026-10-02）

- GitHub 身份：实际账号是 **`Zilong6666`**（不是 zlren）。已把 `package.json`（author/repository/homepage/bugs）、`LICENSE`、`marketplace/*.yml`、`marketplace/PUBLISH.md` 内的 owner 全部改为 Zilong6666。
- 仓库已建并推送：https://github.com/Zilong6666/dsh-task-workspace（public，main 分支，topic `dsh-plugin` 已加；创建时间 `2026-10-02T07:45:44Z`）。插件 git 仓库已设 local user.name=Zilong6666 / user.email=1910693440@qq.com，并执行过 `gh auth setup-git`。
- npm 账号：**`grandparen`**（1910693440@qq.com，`tfa: false`）。`npm publish` 被拒：`E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages`。**待用户开 2FA 或建 granular token**。
- 市场 PR 已备好未提：fork `Zilong6666/awesome-dsh-plugin`，分支 `add-dsh-task-workspace`（commit `8e5d01d`，只新增 `data/plugins/Zilong6666__dsh-task-workspace.yml`，字段 url/name/category/description 与既有 4412 条一致，已用 YAML 解析校验）。因 CI 要求被收录仓库满 1 天，**PR 需等到 2026-10-03 07:45Z（北京时间 15:45）之后**再开。
- 顺带修掉两个打包/杂物问题：`files` 补 `skills`（原来 `skills/task-workspace/SKILL.md` 不进 npm 包）；删掉误建在插件目录里的两个空任务目录 `dbg-20261002`、`会话日志回退-20261002`。
- 发布 tarball 预览：12 个文件、25.7 kB（LICENSE/README×2/bin/cordis.patch.yml/package.json/scripts×2/skills/SKILL.md/src×3）。

- **结论：不依赖 npm 也能上架**。已建 GitHub Release `v0.1.0`（资产 `dsh-task-workspace-0.1.0.tgz`，25.7 kB，https://github.com/Zilong6666/dsh-task-workspace/releases/tag/v0.1.0 ）；市场条目加 `tarball:` 指向该资产；已用 bundled pnpm 实测 `pnpm add <tarball-url>` 安装成功，装出的目录含 `dsh.bundle` 与 `skills/task-workspace/SKILL.md`。npm 侧因账号无 2FA 且 granular token 页面「Select organizations」为空（无组织可选）而卡死，暂不阻塞上架。

## 下一步

- 重发 Release v0.2.1 并更新市场条目 tarball URL

## 产出物

- PROGRESS.md
- package.json
- cordis.patch.yml
- src/store.mjs
- src/index.mjs
- src/cli.mjs
- bin/dsh-task.mjs
- skills/task-workspace/SKILL.md
- test/run.mjs
- README.md
- README.zh.md
- LICENSE
- scripts/install-into-profile.sh
- scripts/append-bundle.mjs
- marketplace/data__plugins__zlren__dsh-task-workspace.yml
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
- 加第 5 个工具 task_tidy + src/tidy.mjs + CLI tidy，补 6 项测试（35→41），文档同步，版本 0.2.0
- 修空目录误删：默认跳过空目录，仅在显式要求时删除；补 1 项测试（41→42）；文档同步；版本 0.2.1

