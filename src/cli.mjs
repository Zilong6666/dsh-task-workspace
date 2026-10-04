#!/usr/bin/env node
/**
 * dsh-task-workspace CLI — the same convention, usable without a model.
 *
 *   dsh-task new "<任务名>" ["<目标>"] [--git] [--slug s] [--session id] [--root DIR] [--force]
 *   dsh-task progress <任务目录|任务名> [--summary TEXT] [--changelog TEXT]
 *                                 [--status S] [--next TEXT] [--deliverables TEXT]
 *                                 [--goal TEXT] [--no-commit] [--root DIR]
 *   dsh-task git <任务目录|任务名> [--message M] [--no-commit] [--root DIR]
 *   dsh-task list [--root DIR] [--limit N]
 *   dsh-task config [--root DIR] [--no-git]
 *
 * Exit codes: 0 ok, 1 usage error, 2 operation failed.
 *
 * @module dsh-task-workspace/cli
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  appendChangelog,
  applySummarize,
  createTask,
  findProgressFile,
  gitAuthor,
  gitForTask,
  listTasks,
  readTask,
  resolveTaskDir,
  resolveWorkspaceRoot,
  setGoal,
  setSection,
} from './store.mjs';
import { applyCleanup, formatBytes, renderIndex, scanWorkspace, writeIndex } from './tidy.mjs';
import { DEFAULTS, loadConfig, saveConfig } from './index.mjs';

const USAGE = `dsh-task — 任务工作区约定 CLI

用法：
  dsh-task new "<任务名>" ["<目标>"] [--git] [--slug <slug>] [--session <会话id>] [--force] [--root <目录>]
  dsh-task progress <任务目录|任务名> [--summary <文本>] [--changelog <文本>]
                    [--status <状态>] [--next <文本>] [--deliverables <文本>]
                    [--goal <文本>] [--no-commit] [--root <目录>]
  dsh-task git <任务目录|任务名> [--message <消息>] [--no-commit] [--root <目录>]
  dsh-task list [--limit <N>] [--root <目录>]
  dsh-task tidy [--apply] [--empty-dirs] [--index-file <文件>] [--no-index] [--json] [--root <目录>]
  dsh-task config [--root <目录>] [--no-git]
`;

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [rawKey, inline] = token.slice(2).split('=');
      const key = rawKey;
      if (inline !== undefined) {
        flags[key] = inline;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(token);
    }
  }
  return { positionals, flags };
}

const flag = (flags, key) => {
  const value = flags[key];
  return value === true || value === undefined ? undefined : String(value);
};

function root(flags) {
  const cfg = loadConfig();
  return resolveWorkspaceRoot(flag(flags, 'root'), cfg.workspaceRoot, process.cwd());
}

function selectTask(rootDir, selector) {
  if (typeof selector !== 'string' || selector.trim().length === 0) {
    throw new Error('缺少任务目录或任务名');
  }
  const direct = resolveTaskDir(selector, rootDir);
  if (existsSync(direct)) return direct;
  const query = selector.trim().toLowerCase();
  const hits = listTasks(rootDir).filter((entry) =>
    [entry.folder, entry.name, entry.goal].some((field) => field.toLowerCase().includes(query)),
  );
  if (hits.length === 0) throw new Error(`在 ${rootDir} 下找不到匹配 "${selector}" 的任务`);
  if (hits.length > 1) {
    throw new Error(`"${selector}" 匹配多个任务：${hits.map((entry) => entry.folder).join('、')}`);
  }
  return hits[0].dir;
}

function cmdNew(args) {
  const rootDir = root(args.flags);
  const [name, goal] = args.positionals;
  if (name === undefined) throw new Error('用法：dsh-task new "<任务名>" ["<目标>"]');
  const cfg = loadConfig();
  const { task, created, reused } = createTask({
    root: rootDir,
    name,
    goal: goal ?? '',
    slug: flag(args.flags, 'slug'),
    force: args.flags.force === true,
    sessionId: flag(args.flags, 'session'),
    template: typeof cfg.template === 'string' && cfg.template.length > 0 ? cfg.template : undefined,
  });
  let gitLine = '';
  if (args.flags.git === true || cfg.defaultGit === true) {
    const result = gitForTask(task.dir, { author: gitAuthor(cfg.gitAuthor) });
    gitLine = `\ngit: ${result.initialized ? '已初始化仓库' : '仓库已存在'}${result.committed ? `，已提交 ${result.head}` : ''}`;
  }
  const head = reused === true ? '已复用本会话已有的' : created ? '已创建' : '已存在';
  process.stderr.write(`${head}任务目录：${task.dir}\n进度文件：${task.progressFile}${gitLine}\n`);
  process.stdout.write(`${task.dir}\n`);
}

function cmdProgress(args) {
  const rootDir = root(args.flags);
  const dir = selectTask(rootDir, args.positionals[0]);
  const progressFile = findProgressFile(dir);
  if (progressFile === undefined) throw new Error(`${dir} 下没有进度文件`);
  let content = readFileSync(progressFile, 'utf8');
  const changed = [];
  const summary = flag(args.flags, 'summary');
  const status = flag(args.flags, 'status');
  const next = flag(args.flags, 'next');
  const deliverables = flag(args.flags, 'deliverables');
  const goal = flag(args.flags, 'goal');
  const changelog = flag(args.flags, 'changelog');
  if (goal !== undefined) {
    content = setGoal(content, goal);
    changed.push('目标');
  }
  if (summary !== undefined) {
    content = applySummarize(content, summary).content;
    changed.push('当前进度');
  }
  if (status !== undefined) {
    content = setSection(content, '状态', status);
    changed.push('状态');
  }
  if (next !== undefined) {
    content = setSection(content, '下一步', mdList(next));
    changed.push('下一步');
  }
  if (deliverables !== undefined) {
    content = setSection(content, '产出物', mdList(deliverables));
    changed.push('产出物');
  }
  if (changelog !== undefined) {
    content = appendChangelog(content, changelog);
    changed.push('变更日志');
  }
  if (changed.length === 0) throw new Error('没有要更新的内容（用 --summary/--changelog/--status/... 指定）');
  writeFileSync(progressFile, content, 'utf8');
  let gitLine = '';
  const current = readTask(dir);
  if (args.flags['no-commit'] !== true && current !== undefined && current.hasGit) {
    const result = gitForTask(dir, { author: gitAuthor(loadConfig().gitAuthor), init: false });
    gitLine = result.committed ? `\ngit: 已提交 ${result.head}` : '\ngit: 无改动需要提交';
  }
  process.stderr.write(`已覆盖更新 ${progressFile}\n改动：${changed.join('、')}${gitLine}\n`);
  process.stdout.write(`${progressFile}\n`);
}

function cmdGit(args) {
  const rootDir = root(args.flags);
  const dir = selectTask(rootDir, args.positionals[0]);
  const cfg = loadConfig();
  const result = gitForTask(dir, {
    author: gitAuthor(cfg.gitAuthor),
    message: flag(args.flags, 'message'),
  });
  process.stderr.write(
    `${result.initialized ? '已初始化' : '已存在'}仓库：${dir}/.git` +
      (result.committed ? `\n已提交：${result.head}` : '\n无改动需要提交') +
      (result.changes.length > 0 ? `\n文件：${result.changes.slice(0, 20).join(', ')}` : '') +
      '\n',
  );
  process.stdout.write(`${dir}/.git\n`);
}

function cmdList(args) {
  const rootDir = root(args.flags);
  const limit = Number.parseInt(flag(args.flags, 'limit') ?? '20', 10);
  const tasks = listTasks(rootDir).slice(0, Number.isFinite(limit) ? limit : 20);
  if (tasks.length === 0) {
    process.stderr.write(`${rootDir} 下还没有任务目录\n`);
    return;
  }
  for (const entry of tasks) {
    process.stdout.write(
      [entry.folder, entry.hasGit ? 'git' : '-', entry.status || '-', entry.goal].join('\t') + '\n',
    );
  }
}

function cmdConfig(args) {
  const rootDir = root(args.flags);
  const patch = { workspaceRoot: rootDir };
  if (args.flags['no-git'] === true) patch.defaultGit = false;
  if (args.flags.git === true) patch.defaultGit = true;
  const file = saveConfig(patch);
  process.stderr.write(`已写入配置：${file}\n${JSON.stringify(loadConfig(), null, 2)}\n`);
  process.stdout.write(`${file}\n`);
}

function cmdTidy(args) {
  const rootDir = root(args.flags);
  const dryRun = args.flags.apply !== true;
  const scan = scanWorkspace(rootDir);
  const { removed, skipped, warnings, freed_bytes } = applyCleanup(scan, {
    dryRun,
    emptyDirs: args.flags['empty-dirs'] === true || args.flags.empty_dirs === true,
  });
  let indexFile = '';
  if (args.flags.index !== false) {
    indexFile = writeIndex(rootDir, renderIndex(scan, { removed: dryRun ? [] : removed }), {
      file: flag(args.flags, 'index-file') ?? flag(args.flags, 'index_file') ?? undefined,
    });
  }
  if (args.flags.json === true) {
    process.stdout.write(
      `${JSON.stringify(
        {
          root: rootDir,
          index_file: indexFile,
          applied: !dryRun,
          entry_count: scan.totals.entries,
          task_count: scan.totals.tasks,
          junk_count: scan.junk.length,
          stray_count: scan.strays.length,
          empty_dir_count: skipped.length,
          removed: removed.map((item) => item.rel),
          freed_bytes,
          heavy: scan.totals.heavy.map((entry) => `${entry.name}（${formatBytes(entry.bytes)}）`),
          warnings,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  process.stderr.write(
    `${rootDir}：${scan.totals.entries} 个顶层条目，任务 ${scan.totals.tasks} 个\n` +
      (dryRun
        ? `待清理 ${removed.length} 项（dry run，未删除；加 --apply 执行）：\n`
        : `已清理 ${removed.length} 项，释放 ${formatBytes(freed_bytes)}：\n`) +
      (removed.length > 0 ? `${removed.map((item) => `  ${item.rel}`).join('\n')}\n` : '') +
      (scan.totals.heavy.length > 0
        ? `大体积中间产物（未动）：${scan.totals.heavy.map((entry) => `${entry.name} ${formatBytes(entry.bytes)}`).join('、')}\n`
        : '') +
      (skipped.length > 0 ? `空目录 ${skipped.length} 个：仅提示，未删除（要删加 --empty-dirs）\n` : '') +
      (indexFile.length > 0 ? `索引：${indexFile}\n` : '') +
      (warnings.length > 0 ? `${warnings.map((item) => `警告：${item}`).join('\n')}\n` : ''),
  );
}

function mdList(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => (line.startsWith('-') ? line : `- ${line}`))
    .join('\n');
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  const args = parseArgs(rest);
  switch (command) {
    case 'new':
      cmdNew(args);
      return 0;
    case 'progress':
      cmdProgress(args);
      return 0;
    case 'git':
      cmdGit(args);
      return 0;
    case 'list':
    case 'ls':
      cmdList(args);
      return 0;
    case 'config':
      cmdConfig(args);
      return 0;
    case 'tidy':
      cmdTidy(args);
      return 0;
    case 'defaults':
      process.stdout.write(`${JSON.stringify(DEFAULTS, null, 2)}\n`);
      return 0;
    default:
      process.stderr.write(`未知命令：${command}\n\n${USAGE}`);
      return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`错误：${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    });
}

export { main, parseArgs, selectTask };
