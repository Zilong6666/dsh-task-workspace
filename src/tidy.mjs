/**
 * Workspace tidy: read a workspace root, classify what lives in it, write a
 * regenerable index, and remove only provably disposable files.
 *
 * Nothing here touches a task folder's contents: the destructive half is
 * limited to OS litter (`.DS_Store`, `__pycache__`, editor backups, packed
 * tarballs), empty nested folders, and stray task folders the plugin itself
 * created in the wrong place (a folder whose only content is its PROGRESS.md).
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { PROGRESS_NAMES, findProgressFile, readTask } from './store.mjs';

export const INDEX_FILE = '工作区索引.md';

/** Directories never descended into while scanning. */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '.dsh-tasks']);

/** File names that are litter anywhere they appear. */
export const JUNK_NAMES = ['.DS_Store', '.localized', 'Thumbs.db', 'desktop.ini'];

/** Extensions that are litter or regenerate-able build output. */
export const JUNK_EXTS = ['.pyc', '.bak', '.orig', '.rej', '.tmp', '.tgz'];

/** Cache directories that are litter anywhere they appear. */
export const JUNK_DIRS = ['__pycache__', '.pytest_cache', '.mypy_cache', '.ipynb_checkpoints'];

/** Names/keywords that mark a top-level folder as intermediate output. */
const CACHE_HINTS = ['_extraction', 'graphflow-out', '.graphflow-cache', 'cache', '缓存'];

/** Folders that hold tooling rather than task output. */
const TOOL_DIRS = new Set(['scripts', 'skills', 'bin', 'templates']);

/** Above this size a folder without a README/PROGRESS is flagged as heavy. */
const HEAVY_BYTES = 200 * 1024 * 1024;

const day = 86400000;

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

/** `YYYY-MM-DD HH:MM` in the given offset (default UTC+8). */
export function stamp(now = new Date(), offsetMinutes = 480) {
  const shifted = new Date(now.getTime() + offsetMinutes * 60000);
  const iso = shifted.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function ageDays(mtimeMs, now = Date.now()) {
  if (!Number.isFinite(mtimeMs)) return Infinity;
  return (now - mtimeMs) / day;
}

/** Recursive file count and byte total, skipping `.git` and friends. */
export function measure(path, { skip = SKIP_DIRS } = {}) {
  let bytes = 0;
  let files = 0;
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        stack.push(join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      try {
        bytes += statSync(join(current, entry.name)).size;
      } catch {
        // A file that vanished mid-scan simply does not count.
      }
    }
  }
  return { bytes, files };
}

function classify(name, { isDir, hasProgress, hasReadme, hasGit, bytes }) {
  if (!isDir) return name.toLowerCase().endsWith('.md') ? '文档' : '散落文件';
  if (name.startsWith('.')) return '配置';
  if (hasProgress) return '任务';
  if (TOOL_DIRS.has(name) || name === 'src' || name === 'test') return '工具';
  if (CACHE_HINTS.some((hint) => name.toLowerCase().includes(hint))) return '中间产物';
  if (hasReadme) return '产出';
  if (bytes >= HEAVY_BYTES) return '中间产物';
  if (/(^|[-_])(out|dist|build|tmp|cache)([-_]|$)/.test(name.toLowerCase())) return '中间产物';
  return '产出';
}

const README_NAMES = ['README.md', 'README.zh.md', 'readme.md', '总览.md', 'PLAYBOOK.md'];

function hasReadme(dir) {
  return README_NAMES.some((name) => existsSync(join(dir, name)));
}

/**
 * Scan the top level of a workspace root.
 *
 * @returns {{root: string, entries: Array<object>, junk: Array<object>, strays: Array<object>, totals: object}}
 */
export function scanWorkspace(root, { now = Date.now(), home } = {}) {
  const dir = resolve(root);
  const entries = [];
  let names = [];
  try {
    names = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`cannot read workspace root ${dir}: ${String(error?.message ?? error)}`);
  }
  for (const dirent of names) {
    if (dirent.name === '.DS_Store') continue;
    const abs = join(dir, dirent.name);
    const isDir = dirent.isDirectory();
    let bytes = 0;
    let files = 1;
    let mtimeMs = 0;
    if (isDir) {
      const measured = measure(abs);
      bytes = measured.bytes;
      files = measured.files;
    } else {
      try {
        const info = statSync(abs);
        bytes = info.size;
        mtimeMs = info.mtimeMs;
      } catch {
        continue;
      }
    }
    try {
      mtimeMs = mtimeMs || statSync(abs).mtimeMs;
    } catch {
      // keep 0
    }
    const task = isDir ? readTask(abs) : undefined;
    const entry = {
      name: dirent.name,
      path: abs,
      isDir,
      bytes,
      files,
      mtime: stamp(new Date(mtimeMs)),
      age_days: Math.round(ageDays(mtimeMs, now)),
      git: isDir && existsSync(join(abs, '.git')),
      task: Boolean(task),
      goal: task?.goal ?? '',
      status: task?.status ?? '',
      category: classify(dirent.name, {
        isDir,
        hasProgress: Boolean(task),
        hasReadme: isDir && hasReadme(abs),
        hasGit: existsSync(join(abs, '.git')),
        bytes,
      }),
    };
    entries.push(entry);
  }
  entries.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name, 'zh'));
  const totals = {
    entries: entries.length,
    tasks: entries.filter((entry) => entry.task).length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    heavy: entries.filter((entry) => entry.category === '中间产物' && entry.bytes >= HEAVY_BYTES),
  };
  return { root: dir, entries, junk: collectJunk(dir), strays: findStrayTasks({ home }), totals };
}

/**
 * Every disposable file/folder under `root`: OS litter, caches, editor
 * backups, packed tarballs, and empty nested folders.
 */
export function collectJunk(root, { maxDepth = 6 } = {}) {
  const dir = resolve(root);
  const out = [];
  // Returns whether the subtree still holds content, and whether some
  // descendant was already reported as an empty folder (so the parent is not
  // reported too — removing the parent would cover it twice).
  const walk = (current, depth) => {
    let dirents;
    try {
      dirents = readdirSync(current, { withFileTypes: true });
    } catch {
      return { hasFiles: true, pushed: false };
    }
    let hasFiles = false;
    let childPushed = false;
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue;
      const abs = join(current, dirent.name);
      if (dirent.isDirectory()) {
        if (SKIP_DIRS.has(dirent.name)) {
          hasFiles = true;
          continue;
        }
        if (JUNK_DIRS.includes(dirent.name)) {
          const { bytes, files } = measure(abs);
          out.push({
            kind: 'dir',
            path: abs,
            rel: relative(dir, abs),
            reason: `${dirent.name} 缓存目录`,
            bytes,
            files,
          });
          hasFiles = true;
          continue;
        }
        if (depth < maxDepth) {
          const child = walk(abs, depth + 1);
          if (child.hasFiles) hasFiles = true;
          if (child.pushed) childPushed = true;
        } else {
          hasFiles = true;
        }
        continue;
      }
      if (!dirent.isFile()) continue;
      hasFiles = true;
      const lower = dirent.name.toLowerCase();
      const ext = lower.startsWith('.') ? lower : lower.slice(lower.lastIndexOf('.'));
      const junkName = JUNK_NAMES.includes(dirent.name);
      const junkExt = JUNK_EXTS.includes(ext);
      if (!junkName && !junkExt) continue;
      let bytes = 0;
      try {
        bytes = statSync(abs).size;
      } catch {
        // ignore
      }
      out.push({
        kind: 'file',
        path: abs,
        rel: relative(dir, abs),
        reason: junkName ? '系统垃圾文件' : `${ext} 备份/打包产物`,
        bytes,
        files: 1,
      });
    }
    if (depth > 0 && !hasFiles) {
      out.push({
        kind: 'dir',
        path: current,
        rel: relative(dir, current),
        reason: '空目录',
        bytes: 0,
        files: 0,
      });
      return { hasFiles: false, pushed: true };
    }
    return { hasFiles, pushed: false };
  };
  walk(dir, 0);
  // Keep only the outermost empty folder of each empty subtree: deleting the
  // ancestor already removes the nested ones.
  const emptyPaths = new Set(out.filter((item) => item.reason === '空目录').map((item) => item.path));
  if (emptyPaths.size > 1) {
    const nested = new Set();
    for (const path of emptyPaths) {
      for (let parent = dirname(path); parent.startsWith(dir) && parent !== dir; parent = dirname(parent)) {
        if (emptyPaths.has(parent)) {
          nested.add(path);
          break;
        }
      }
    }
    return out.filter((item) => !nested.has(item.path));
  }
  return out;
}

/** True when every file in the tree is a progress file (nothing else was ever written). */
function onlyProgressFiles(dir) {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) {
        stack.push(join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (!PROGRESS_NAMES.includes(entry.name)) return false;
    }
  }
  return true;
}

/**
 * Task folders the plugin created outside a workspace: a stamped folder whose
 * only content is its own PROGRESS file. Anything else is left alone.
 */
export function findStrayTasks({ home } = {}) {
  const base = home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh');
  const profiles = join(base, 'profiles');
  const out = [];
  let profileNames = [];
  try {
    profileNames = readdirSync(profiles, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return out;
  }
  for (const profile of profileNames) {
    const dir = join(profiles, profile);
    let names = [];
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of names) {
      if (!dirent.isDirectory()) continue;
      const candidate = join(dir, dirent.name);
      const progress = findProgressFile(candidate);
      if (progress === undefined) continue;
      if (existsSync(join(candidate, '.git'))) continue;
      const { bytes, files } = measure(candidate);
      if (bytes > 64 * 1024 || !onlyProgressFiles(candidate)) continue;
      out.push({
        path: candidate,
        rel: `${profile}/${dirent.name}`,
        progress_file: progress,
        bytes,
        files,
      });
    }
  }
  return out;
}

/** Markdown index for a scan result. Always fully regenerated. */
export function renderIndex(scan, { removed = [], indexFile = INDEX_FILE, now = new Date() } = {}) {
  const { root, entries, junk, strays, totals } = scan;
  const lines = [];
  lines.push('# 工作区索引');
  lines.push('');
  lines.push('> 本文件由 `dsh-task tidy` / `task_tidy` 自动生成，覆盖写入，请勿手工编辑。');
  lines.push(`> 根目录：\`${root}\`；生成时间：${stamp(now)}（UTC+8）。`);
  lines.push(
    `> 重新生成：\`dsh-task tidy\`。上次清理：删除 ${removed.length} 项，释放 ${formatBytes(
      removed.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0),
    )}。`,
  );
  lines.push('');
  lines.push('## 统计');
  lines.push('');
  lines.push(`- 顶层条目：${totals.entries}；任务：${totals.tasks}；合计占用：${formatBytes(totals.bytes)}`);
  lines.push(
    `- 待清理候选：${junk.length} 项；越界遗留任务目录：${strays.length} 项；大体积中间产物：${totals.heavy.length} 项`,
  );
  lines.push('');
  const section = (title, rows, note) => {
    lines.push(`## ${title}`);
    lines.push('');
    if (note) lines.push(`_${note}_`);
    if (note) lines.push('');
    if (rows.length === 0) {
      lines.push('（无）');
      lines.push('');
      return;
    }
    lines.push('| 名称 | 大小 | 文件 | 最后修改 | 说明 |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const entry of rows) {
      const note2 = entry.task
        ? `${entry.status || '无状态'}｜目标：${entry.goal || '（未写）'}`
        : entry.category;
      lines.push(
        `| ${entry.name}${entry.git ? ' `git`' : ''} | ${formatBytes(entry.bytes)} | ${entry.files} | ${entry.mtime} | ${note2} |`,
      );
    }
    lines.push('');
  };
  section('任务（含 PROGRESS.md）', entries.filter((entry) => entry.task));
  section('产出与文档', entries.filter((entry) => ['产出', '文档'].includes(entry.category)));
  section(
    '中间产物（自查后自行决定归档或删除）',
    entries.filter((entry) => entry.category === '中间产物'),
    '这些目录体积通常最大；插件不会自动删除它们。',
  );
  section('工具、配置与散落文件', entries.filter((entry) => ['工具', '配置', '散落文件'].includes(entry.category)));
  lines.push('## 待清理');
  lines.push('');
  if (junk.length === 0 && strays.length === 0) {
    lines.push('（无）');
  } else {
    if (strays.length > 0) {
      lines.push('越界遗留任务目录（内容只有自身进度文件）：');
      for (const item of strays) lines.push(`- \`${item.path}\`（${item.files} 文件，${formatBytes(item.bytes)}）`);
      lines.push('');
    }
    if (junk.length > 0) {
      lines.push(`垃圾文件/缓存（展示前 ${Math.min(junk.length, 40)} 项，共 ${junk.length} 项）：`);
      for (const item of junk.slice(0, 40)) lines.push(`- \`${item.rel}\` — ${item.reason}`);
      if (junk.length > 40) lines.push(`- …其余 ${junk.length - 40} 项`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function writeIndex(root, markdown, { file = INDEX_FILE, dryRun = false } = {}) {
  const target = resolve(root, file);
  if (dryRun) return target;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, markdown, 'utf8');
  return target;
}

/**
 * Remove the safe candidates only: junk files, cache dirs, and stray task
 * folders. Returns what was (or would be) removed.
 */
export function applyCleanup(scan, { dryRun = true } = {}) {
  const removed = [];
  const warnings = [];
  for (const item of scan.junk) {
    removed.push({ path: item.path, rel: item.rel, reason: item.reason, bytes: item.bytes });
    if (!dryRun) {
      try {
        rmSync(item.path, { recursive: true, force: true });
      } catch (error) {
        warnings.push(`删除失败 ${item.rel}: ${String(error?.message ?? error)}`);
      }
    }
  }
  for (const stray of scan.strays) {
    removed.push({
      path: stray.path,
      rel: stray.rel,
      reason: '越界遗留任务目录（仅含进度文件）',
      bytes: stray.bytes,
    });
    if (!dryRun) {
      try {
        rmSync(stray.path, { recursive: true, force: true });
      } catch (error) {
        warnings.push(`删除失败 ${stray.rel}: ${String(error?.message ?? error)}`);
      }
    }
  }
  return { removed, warnings, freed_bytes: removed.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0) };
}
