# DSH 任务工作区插件

> 任务目录：`dsh-task-workspace-20261002/` · 唯一进度文件：本文件（每次修改后**覆盖更新**）

## 目标
把「任务工作区约定」（一个任务一个目录、一个任务一个覆盖式 PROGRESS.md、任务过长建 git）做成 DSH 插件 `dsh-task-workspace`，并上架 awesome-dsh-plugin 插件市场。

## 状态

进行中

## 当前进度

插件本体、文档、市场条目、自测、真机加载全部完成，**已装进 desktop profile 并在当前会话中生效**（本会话可调用 task_new/task_progress/task_git/task_list 四个工具，系统提示里已注入「任务工作区约定」段落）。

- **实现**：`src/store.mjs`（纯函数：任务目录/索引/PROGRESS 六段/长摘要自动压缩/git 提交）、`src/index.mjs`（Host 插件：1 个提示词段落 + 4 个工具 + 1 个技能）、`src/cli.mjs` + `bin/dsh-task.mjs`（命令行）、`cordis.patch.yml`。
- **自测**：`node test/run.mjs` = **35 passed, 0 failed**（store + 插件装配 + 真实 git + CLI + 宿主 JSON Schema 子集符合性 + 会话 cwd 回退与内部目录护栏），不联网、不需要模型。
- **真机验证链**：web profile 安装 → 启动 8099 日志 **0 warning** → 真实 Cordis 容器 `registry.plugin()` 注册出 4 工具 + 1 段落 + 1 技能 → `--dump-config` 出现该 bundle → 装进 desktop profile → 本会话 `cordis_inspect_query host/Tool/listTools` 查得 `task_new`/`task_progress`/`task_git`/`task_list` 四个工具均在列。
- **四个真机才暴露的 bug 已修**：① `inject` 被 loader 的 `unwrapExports` 丢掉（须挂到导出函数属性 `apply.inject`）；② 输出 schema 的 `required` 是对象级关键字（不能写在标量属性上）；③ 宿主进程 cwd 是 `~/.dsh/profiles/desktop`，四个工具从未把 `exec` 传给 `rootFor`，导致任务目录被建到 DSH 内部目录（改 `execute(args, exec)` + `cwdFor` 三级回退 + `isBlockedRoot` 拒绝 DSH_HOME/DSH_PROFILE_DIR）；④ 更早的 git 参数顺序 / 显式 root / Markdown 空行问题。
- **desktop profile 安装**：`bash scripts/install-into-profile.sh desktop` 已执行，`~/.dsh/profiles/desktop/package.json` 追加了 `dsh-task-workspace` 依赖与 bundle（备份 `package.json.bak`），但 `dsh --profile desktop --dump-config` 被应用独占拒绝，无法从命令行复核。

## 上线进展（2026-10-02）

- GitHub 身份：实际账号是 **`Zilong6666`**（不是 zlren）。已把 `package.json`（author/repository/homepage/bugs）、`LICENSE`、`marketplace/*.yml`、`marketplace/PUBLISH.md` 内的 owner 全部改为 Zilong6666。
- 仓库已建并推送：https://github.com/Zilong6666/dsh-task-workspace（public，main 分支，topic `dsh-plugin` 已加；创建时间 `2026-10-02T07:45:44Z`）。插件 git 仓库已设 local user.name=Zilong6666 / user.email=1910693440@qq.com，并执行过 `gh auth setup-git`。
- npm 账号：**`grandparen`**（1910693440@qq.com，`tfa: false`）。`npm publish` 被拒：`E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages`。**待用户开 2FA 或建 granular token**。
- 市场 PR 已备好未提：fork `Zilong6666/awesome-dsh-plugin`，分支 `add-dsh-task-workspace`（commit `8e5d01d`，只新增 `data/plugins/Zilong6666__dsh-task-workspace.yml`，字段 url/name/category/description 与既有 4412 条一致，已用 YAML 解析校验）。因 CI 要求被收录仓库满 1 天，**PR 需等到 2026-10-03 07:45Z（北京时间 15:45）之后**再开。
- 顺带修掉两个打包/杂物问题：`files` 补 `skills`（原来 `skills/task-workspace/SKILL.md` 不进 npm 包）；删掉误建在插件目录里的两个空任务目录 `dbg-20261002`、`会话日志回退-20261002`。
- 发布 tarball 预览：12 个文件、25.7 kB（LICENSE/README×2/bin/cordis.patch.yml/package.json/scripts×2/skills/SKILL.md/src×3）。

## 下一步

- **npm 发布**：用户二选一——① 在 https://www.npmjs.com/settings/grandparen/tfa 开启 2FA 后，发布时把 6 位 OTP 给我，我执行 `npm publish --otp=<code> --access public`；② 在 https://www.npmjs.com/settings/grandparen/tokens 建 Granular Access Token（read+write、勾选 bypass 2FA、短有效期），把 token 给我写入 `~/.npmrc` 后发布（发布完可撤销）。
- **市场 PR**：2026-10-03 07:45Z 之后，用已备好的分支 `add-dsh-task-workspace` 向 awesome-dsh-plugin 提 PR。
- **用户重启 DSH 应用**后，cwd 修复才在桌面端生效（当前运行进程里仍是旧代码）。
- 可选清理：dsh plugin --profile web remove dsh-task-workspace（验证用的 web profile 安装）

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
| 2026-10-02 15:50 | 修 `files` 缺 `skills`；删掉误建的两个空任务目录；fork awesome-dsh-plugin 并推分支 `add-dsh-task-workspace`（commit 8e5d01d），PR 待仓库满 1 天后开 |
| 2026-10-02 15:30（会话整理任务中发现） | 修第四个真机 bug：四个工具 `execute(args)` 未接 `exec`、`rootFor(args.workspace, undefined)`，cwd 永远解析不到而退回 `process.cwd()`；改 `execute(args, exec)`+`rootFor(..., exec)`，`cwdFor` 增加 workspaceRegistry → agents.get → 会话日志首帧三级回退，`isBlockedRoot` 拒绝 DSH_HOME/DSH_PROFILE_DIR 及其子目录；补 3 项回归测试，自测 **35 passed** |
