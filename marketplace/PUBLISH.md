# 发布到插件市场（awesome-dsh-plugin）

插件本体、文档、自测、市场条目文件都已完成，只剩「发布」这一步——它需要 GitHub / npm 身份，
因此必须由你授权或你亲自执行。下面按顺序列清楚。

## 0. 前置检查

```bash
gh auth status            # 需要已登录 GitHub（当前：未登录任何 host）
npm whoami                # 需要已登录 npm（当前：ENEEDAUTH）
git config user.name      # 当前为空；下面用 -c 临时指定
```

## 1. 建仓库并推送

```bash
cd /Users/zlren/Desktop/deepseekai工作区/dsh-task-workspace-20261002

# 仓库名必须是 dsh-task-workspace（与 package.json 的 repository 字段一致，
# 也决定市场条目里的 url 与文件名）
gh repo create zlren/dsh-task-workspace --public --source=. --remote=origin \
  --description "Task workspace convention for DSH: one folder per task, one overwritten PROGRESS.md, per-task git."

git -c user.name="zlren" -c user.email="<你的邮箱>" add -A
git -c user.name="zlren" -c user.email="<你的邮箱>" commit -m "feat: 任务工作区约定插件（提示词段落 + 4 个工具 + 技能）"
git push -u origin HEAD
```

市场 CI 会检查仓库 topic，务必加上：

```bash
gh repo edit zlren/dsh-task-workspace --add-topic dsh-plugin
```

> ⚠️ 仓库创建必须满 **1 天** 才能提 PR（CI 自动检查）。今天建仓库，明天再走第 3 步。

## 2. 发布 npm 包

```bash
npm login                       # 或 npm config set //registry.npmjs.org/:_authToken=<token>
npm publish --access public     # 包里没有 private 字段；scoped 才需要 --access public
```

发布前先本地确认包内容（`files` 已限定）：

```bash
npm pack --dry-run
```

包名 `dsh-task-workspace` 未被占用（已查 registry）。若已被占用，需要改成 scoped 名
（如 `@zlren/dsh-task-workspace`），并同步修改 `package.json` 的 `name`、
`cordis.patch.yml` 的 `name`、市场条目里的 `name`/`url` 与安装命令。

## 3. 向市场提 PR

市场只接受「新增一个文件」的 PR，不手改 README。

```bash
# fork + clone
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone
cd awesome-dsh-plugin

# 把本仓库准备好的文件放进去（文件名规则：<owner>__<repo>.yml）
cp /Users/zlren/Desktop/deepseekai工作区/dsh-task-workspace-20261002/marketplace/data__plugins__zlren__dsh-task-workspace.yml \
   data/plugins/zlren__dsh-task-workspace.yml

git checkout -b add-dsh-task-workspace
git add data/plugins/zlren__dsh-task-workspace.yml
git commit -m "add zlren/dsh-task-workspace"
git push -u origin add-dsh-task-workspace
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --title "add zlren/dsh-task-workspace" \
  --body "Task workspace convention: one folder per task, one overwritten PROGRESS.md per task, per-task git once the task runs long."
```

条目文件内容（已备好，可直接用）：

```yaml
url: https://github.com/zlren/dsh-task-workspace
name: zlren/dsh-task-workspace
category: workflow
description:
  en: 'Task workspace convention: one folder per task, one PROGRESS.md per task overwritten on each update, and per-task git once the task runs long.'
  zh: '任务工作区约定：一个任务一个目录，一个任务一个 PROGRESS.md（每次修改整体覆盖更新），任务过长就在任务目录里建 git 仓库。'
```

## 4. 上架前自查表（对着 contributing.md）

| 要求 | 本插件状态 |
| --- | --- |
| `package.json` 声明 `dsh.bundle` | ✅ `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`（刻意不声明 `dsh.client`） |
| 仓库根有 `cordis.patch.yml` | ✅ 向 profile 插入 `id: task-workspace` |
| 有真实可用代码 | ✅ `src/` 三个模块 + 自测 32 项 + 真实 runtime 加载验证 |
| 仓库创建满 1 天 | ⏳ 建仓库后次日再提 PR |
| 加 `dsh-plugin` topic | ⏳ 推送后执行 `gh repo edit --add-topic dsh-plugin` |
| 描述与代码相符 | ✅ 描述里只提「一个目录 / 一个覆盖式 PROGRESS.md / 过长建 git」，与 `src/store.mjs` 行为一致 |
| 只新增自己那一个文件 | ✅ 只加 `data/plugins/zlren__dsh-task-workspace.yml` |
| 不手改生成的 README | ✅ 不碰 |

## 5. 收尾

```bash
# 可选：清掉用于验证的临时 web profile 安装
dsh plugin --profile web remove dsh-task-workspace
```
