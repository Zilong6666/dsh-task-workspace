/**
 * dsh-task-workspace — task store.
 *
 * The on-disk contract this plugin enforces, for one workspace directory:
 *
 *   <workspace>/<slug>-<YYYYMMDD>/          one folder per task
 *     PROGRESS.md                           the single progress file of that task
 *   <workspace>/.dsh-tasks.json             lightweight task index (rebuilt on demand)
 *
 * A task *may* carry its own git repository (created with `task_git`); nothing
 * in this module assumes git exists.
 *
 * @module dsh-task-workspace/store
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Progress file names accepted on read, in preference order. */
export const PROGRESS_NAMES = ['PROGRESS.md', '进度.md'];

/** Name of the workspace-level task index. */
export const INDEX_NAME = '.dsh-tasks.json';

/** Reasons a task is considered "long enough" to deserve its own git repository. */
export const GIT_TRIGGERS = [
  '预计超过 3 轮对话',
  '需要跨会话继续',
  '预计产出文件超过 10 个',
  '用户明确要求',
];

/** Six-section progress template. `{{PLACEHOLDER}}` markers are substituted. */
export const PROGRESS_TEMPLATE = `# {{TASK_NAME}}

- 任务目录：\`{{DIR}}\`
- 目标：{{GOAL}}
- 创建时间：{{DATE}}

## 目标

{{GOAL}}

## 状态

进行中

## 当前进度

- 任务工作区已建立（唯一进度文件：\`{{PROGRESS_FILE}}\`）。

## 下一步

- 待补充。

## 产出物

- 待补充。

## 变更日志

- {{DATE}} 建立任务工作区。
`;

const DATE_RE = /-(\d{8})$/;

/** Today's date in the given UTC offset (minutes), formatted `YYYY-MM-DD`. */
export function localDate(offsetMinutes = 480, now = new Date()) {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  const iso = shifted.toISOString();
  return iso.slice(0, 10);
}

/** Compact `YYYYMMDD` date used as the task folder suffix. */
export function compactDate(offsetMinutes = 480, now = new Date()) {
  return localDate(offsetMinutes, now).replaceAll('-', '');
}

/**
 * Turn a free-form task name into a filesystem-safe slug.
 * CJK and other non-ASCII letters are preserved; everything that would need
 * escaping in a shell or a URL becomes `-`.
 */
export function slugify(name, { maxLength = 48 } = {}) {
  const slug = String(name ?? '')
    .normalize('NFKC')
    .trim()
    .replaceAll(/[\s_]+/g, '-')
    .replaceAll(/[^\p{L}\p{N}-]+/gu, '-')
    .replaceAll(/-{2,}/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, maxLength)
    .replaceAll(/^-|-$/g, '');
  return slug.length > 0 ? slug : 'task';
}

/** `slug-YYYYMMDD` for a task name, stable for a given day. */
export function taskFolderName(slug, date) {
  const clean = slugify(slug);
  const suffix = (date ?? compactDate()).replaceAll('-', '');
  return clean.endsWith(suffix) ? clean : `${clean}-${suffix}`;
}

/** A fresh, sortable task id. */
export function newTaskId() {
  return `t${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

/**
 * Resolve the workspace root this plugin operates on.
 *
 * Precedence: explicit argument > config root > $DSH_TASK_WORKSPACE_ROOT >
 * $DSH_WORKSPACE_ROOT > process.cwd() > $DSH_HOME > $HOME.
 *
 * An explicit root (tool argument, config, environment) is authoritative and is
 * created when missing; the later candidates are heuristics and are only used
 * when they already exist and look like a real workspace.
 */
export function resolveWorkspaceRoot(explicit, configRoot, cwd = process.cwd()) {
  const explicitRoot = firstNonEmpty([explicit, configRoot, process.env.DSH_TASK_WORKSPACE_ROOT, process.env.DSH_WORKSPACE_ROOT]);
  if (explicitRoot !== undefined) return ensureRoot(explicitRoot);

  for (const candidate of [cwd, process.env.DSH_HOME, join(homedir(), '.dsh')]) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) continue;
    const path = resolve(candidate);
    if (isPlausibleRoot(path)) return path;
  }
  return ensureRoot(cwd);
}

/** Absolute path of the first non-empty candidate, or `undefined`. */
function firstNonEmpty(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return resolve(value);
    }
  }
  return undefined;
}

/** Validate and create an explicit workspace root. */
function ensureRoot(path) {
  if (isBlockedRoot(path)) {
    throw new Error(`refusing to use ${path} as a task workspace root`);
  }
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
  return path;
}

function isBlockedRoot(path) {
  if (path === resolve('/') || path === resolve(tmpdir())) return true;
  return path.split(/[\\/]/).includes('node_modules');
}

function isPlausibleRoot(path) {
  if (!isAbsolute(path) || isBlockedRoot(path)) return false;
  const home = homedir();
  if (path === join(home, '.dsh') || path === home) return false;
  return existsSync(path) && statSync(path).isDirectory();
}

/** Absolute path of the folder holding `PROGRESS.md` (or its legacy spelling). */
export function resolveTaskDir(taskDir, root) {
  if (typeof taskDir !== 'string' || taskDir.trim().length === 0) {
    throw new Error('task_dir is required');
  }
  const absolute = isAbsolute(taskDir) ? resolve(taskDir) : resolve(root, taskDir);
  return absolute;
}

/** Find the progress file of a task directory, if any. */
export function findProgressFile(taskDir) {
  for (const name of PROGRESS_NAMES) {
    const candidate = join(taskDir, name);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** Read a task directory. Returns `undefined` when it is not a task directory. */
export function readTask(taskDir) {
  if (!existsSync(taskDir) || !statSync(taskDir).isDirectory()) return undefined;
  const progressFile = findProgressFile(taskDir);
  if (progressFile === undefined) return undefined;
  const content = readFileSync(progressFile, 'utf8');
  const stats = statSync(taskDir);
  const nameMatch = /^#\s+(.+)$/m.exec(content);
  const goalMatch = /^-\s*目标[:：]\s*(.+)$/m.exec(content);
  const statusMatch = /^##\s*状态\s*\n+([^\n#]+)/m.exec(content);
  return {
    dir: taskDir,
    folder: basename(taskDir),
    progressFile,
    progressName: basename(progressFile),
    name: nameMatch === null ? basename(taskDir) : nameMatch[1].trim(),
    goal: goalMatch === null ? '' : goalMatch[1].trim(),
    status: statusMatch === null ? '' : statusMatch[1].trim(),
    bytes: Buffer.byteLength(content, 'utf8'),
    updatedAt: stats.mtime.toISOString(),
    hasGit: existsSync(join(taskDir, '.git')),
  };
}

/** List every task directory directly under `root`. */
export function listTasks(root) {
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true });
  const tasks = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const task = readTask(join(root, entry.name));
    if (task !== undefined) tasks.push(task);
  }
  tasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return tasks;
}

/** Read the workspace index, tolerating absence and corruption. */
export function readIndex(root) {
  const file = join(root, INDEX_NAME);
  if (!existsSync(file)) return { version: 1, tasks: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const tasks = parsed !== null && typeof parsed.tasks === 'object' ? parsed.tasks : {};
    return { version: 1, tasks };
  } catch {
    return { version: 1, tasks: {} };
  }
}

/** Write the workspace index (best effort — a read-only workspace never breaks a task). */
export function writeIndex(root, index) {
  const file = join(root, INDEX_NAME);
  try {
    writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    return file;
  } catch {
    return undefined;
  }
}

/** Upsert one task record in the workspace index. */
export function touchIndex(root, record) {
  const index = readIndex(root);
  const previous = index.tasks[record.folder] ?? {};
  index.tasks[record.folder] = { ...previous, ...record, lastSeen: new Date().toISOString() };
  return writeIndex(root, index);
}

/** Fill the progress template for a task. */
export function renderProgress({ taskName, goal, dir, date, template = PROGRESS_TEMPLATE }) {
  const values = {
    TASK_NAME: taskName,
    GOAL: goal,
    DIR: dir,
    DATE: date,
    PROGRESS_FILE: join(dir, 'PROGRESS.md'),
    PROGRESS_NAME: 'PROGRESS.md',
  };
  return template.replaceAll(/\{\{([A-Z_]+)\}\}/g, (match, key) =>
    Object.hasOwn(values, key) ? values[key] : match,
  );
}

/**
 * Create (or adopt) a task directory and write its single progress file.
 *
 * @returns {{task: object, created: boolean, indexFile: string|undefined}}
 */
export function createTask({
  root,
  name,
  goal = '',
  slug,
  date,
  template,
  force = false,
  offsetMinutes = 480,
}) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('task name is required');
  }
  const tasksRoot = resolve(root);
  mkdirSync(tasksRoot, { recursive: true });
  const day = date ?? compactDate(offsetMinutes);
  const folder = taskFolderName(slug ?? name, day);
  const dir = join(tasksRoot, folder);

  if (existsSync(dir)) {
    const existing = readTask(dir);
    if (existing !== undefined) {
      return { task: existing, created: false, indexFile: touchIndex(tasksRoot, record(existing, name, goal)) };
    }
    if (!force) {
      const names = readdirSync(dir);
      if (names.length > 0) {
        throw new Error(
          `task directory already exists and is not a task workspace: ${dir} (pass force=true to adopt it)`,
        );
      }
    }
  } else {
    mkdirSync(dir, { recursive: false });
  }

  const progressFile = join(dir, 'PROGRESS.md');
  writeFileSync(
    progressFile,
    renderProgress({
      taskName: name.trim(),
      goal: goal.trim().length > 0 ? goal.trim() : '待补充',
      dir,
      date: localDate(offsetMinutes),
      template,
    }),
    'utf8',
  );
  const task = readTask(dir);
  return { task, created: true, indexFile: touchIndex(tasksRoot, record(task, name, goal)) };
}

function record(task, name, goal) {
  return {
    id: newTaskId(),
    folder: task.folder,
    name: task.name || name,
    goal: goal.trim(),
    createdAt: task.updatedAt,
  };
}

/** Split text into chunks of at most `maxLines` lines, preserving every line. */
export function chunkLines(text, maxLines = 18) {
  const lines = String(text ?? '').split('\n');
  if (lines.length <= maxLines) return [lines.join('\n')];
  const chunks = [];
  let current = [];
  for (const line of lines) {
    current.push(line);
    if (current.length >= maxLines) {
      chunks.push(current.join('\n'));
      current = [];
    }
  }
  if (current.length > 0) chunks.push(current.join('\n'));
  return chunks;
}

/** Split content into `[prefix, suffix]` at a chunk boundary (uses chunk end lines). */
export function splitForChunks(content, summary, maxLines) {
  const text = String(content ?? '');
  const body = text.trim();
  if (body.length === 0) return ['', text];
  const lines = text.split('\n');
  const uniq = [];
  const seen = new Set();
  for (const raw of String(summary ?? '').split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.length > 200 || seen.has(line)) continue;
    if (!text.includes(line)) continue;
    seen.add(line);
    uniq.push(line);
  }
  const boundaryLines = uniq.length > 0 ? uniq : lines.slice(0, maxLines);
  let last = -1;
  for (const line of boundaryLines) {
    const at = lines.indexOf(line);
    if (at > last) last = at;
  }
  if (last < 0) last = Math.min(maxLines, lines.length) - 1;
  const prefix = lines.slice(0, last + 1).join('\n');
  const suffix = lines.slice(last + 1).join('\n');
  return [prefix, suffix];
}

/** Status words that mean "this task is done". */
const DONE_WORDS = ['已完成', '完成', 'done', 'completed', 'finished'];

/** Overwrite the summary section of a progress file while keeping history. */
export function applySummarize(content, summary, { maxLines = 18 } = {}) {
  const sections = splitSections(content);
  const target = sections.find((section) => section.title === '当前进度');
  if (target === undefined) {
    const appended = `${content.trimEnd()}\n\n## 当前进度\n\n${summary.trim()}\n`;
    return { content: appended, chunks: chunkLines(summary, maxLines) };
  }
  const chunks = chunkLines(summary, maxLines);
  const before = content.slice(0, target.start);
  const after = content.slice(target.end);
  let middle = '## 当前进度\n\n';
  if (chunks.length === 1) {
    middle += `${chunks[0].trim()}\n`;
  } else {
    const [prefix, archive] = splitForChunks(target.body, chunks[0], maxLines);
    middle += `${prefix.trim()}\n`;
    middle += `\n### 进度历史（压缩摘要）\n\n${chunks.join('\n\n---\n\n').trim()}\n`;
    middle += `\n<details>\n<summary>历史原文（自动归档）</summary>\n\n${archive.trim()}\n\n</details>\n`;
  }
  return { content: before + middle + after, chunks };
}

/** Locate `## Title` sections (start offset, end offset, title, body). */
export function splitSections(content) {
  const text = String(content ?? '');
  const matches = [...text.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)];
  const sections = [];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const start = match.index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    sections.push({
      title: match[1].trim(),
      start,
      end,
      body: text.slice(start + match[0].length, end).replace(/^\n+|\n+$/g, ''),
    });
  }
  return sections;
}

/** Ensure a `## Title` section exists; returns the new content. */
export function ensureSection(content, title) {
  const sections = splitSections(content);
  if (sections.some((section) => section.title === title)) return content;
  const tail = content.endsWith('\n') ? '' : '\n';
  return `${content}${tail}\n## ${title}\n\n- 待补充。\n`;
}

/** Append one line to a `## Title` section, creating it when missing. */
export function appendToSection(content, title, line) {
  const text = ensureSection(content, title);
  const target = splitSections(text).find((section) => section.title === title);
  if (target === undefined) return text;
  const body = target.body.replace(/^-\s*待补充。\s*$/m, '').trim();
  const normalized = body.length === 0 ? '' : `${body}\n`;
  const next = `${normalized}- ${line.replace(/^-\s*/, '')}`;
  const rest = text.slice(target.end).replace(/^\n+/, '');
  return `${text.slice(0, target.start)}## ${title}\n\n${next}\n\n${rest}`;
}

/** Append a changelog entry (one line, or a multi-line block). */
export function appendChangelog(content, entry) {
  const line = String(entry ?? '')
    .trim()
    .replace(/^\s*-\s*/, '');
  if (line.length === 0) return content;
  return appendToSection(content, '变更日志', line);
}

/** Replace a `## Title` section body with `body` (creating the section). */
export function setSection(content, title, body) {
  const text = ensureSection(content, title);
  const target = splitSections(text).find((section) => section.title === title);
  if (target === undefined) return text;
  const clean = String(body ?? '').trim();
  const rendered = clean.length === 0 ? '- 待补充。' : clean;
  const rest = text.slice(target.end).replace(/^\n+/, '');
  return `${text.slice(0, target.start)}## ${title}\n\n${rendered}\n\n${rest}`;
}

/** Rewrite the `- 目标：` header line and the `## 目标` section. */
export function setGoal(content, goal) {
  let next = text(content)
    .replace(/^(-\s*目标[:：]\s*).*$/m, `$1${goal}`)
    .replace(/^#\s+.*$/m, (line) => line);
  next = setSection(next, '目标', goal);
  return next;
}

function text(value) {
  return String(value ?? '');
}

/** True when the task looks finished, by its `## 状态` section or the summary. */
export function looksDone(content, summary = '') {
  const status = /^##[ \t]*状态[ \t]*\n+([^\n#]+)/m.exec(String(content ?? ''));
  const haystack = `${status === null ? '' : status[1]} ${summary}`.toLowerCase();
  return DONE_WORDS.some((word) => haystack.includes(word.toLowerCase()));
}

/** Create (or commit into) a git repository for one task directory. */
export function gitForTask(taskDir, { message, author, init = true, add = ['-A'] } = {}) {
  const root = resolve(taskDir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`task directory does not exist: ${root}`);
  }
  const initialized = existsSync(join(root, '.git'));
  if (!initialized) {
    if (!init) {
      throw new Error(`no git repository in ${root}`);
    }
    runGit(root, ['init', '--quiet']);
    writeFileSync(
      join(root, '.gitignore'),
      ['.DS_Store', '__pycache__/', '*.pyc', 'node_modules/', '.venv/', '*.tmp'].join('\n') + '\n',
      'utf8',
    );
  }
  runGit(root, ['add', ...add]);
  const staged = runGit(root, ['diff', '--cached', '--name-only']).trim();
  const hasChanges = staged.length > 0;
  let committed = false;
  if (hasChanges || !initialized) {
    const fallback = initialized ? 'progress: 更新进度文件' : 'chore: 初始化任务仓库';
    const identity =
      author === undefined || typeof author.name !== 'string' || author.name.length === 0
        ? []
        : ['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`];
    // Global options must precede the subcommand: `git -c k=v commit -m …`.
    runGit(root, [...identity, 'commit', '--quiet', '-m', message ?? fallback]);
    committed = true;
  }
  const head = safeGit(root, ['log', '-1', '--pretty=%h %s']);
  return {
    dir: root,
    gitDir: join(root, '.git'),
    initialized: !initialized,
    committed,
    changes: staged.length === 0 ? [] : staged.split('\n'),
    head,
  };
}

function runGit(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function safeGit(cwd, args) {
  try {
    return runGit(cwd, args).trim();
  } catch {
    return '';
  }
}

/** Git identity fallback so the first commit works on a machine without git config. */
export function gitAuthor(config) {
  if (config !== undefined && typeof config === 'object' && config !== null) {
    const name = typeof config.name === 'string' ? config.name : undefined;
    const email = typeof config.email === 'string' ? config.email : undefined;
    if (name !== undefined && email !== undefined) return { name, email };
  }
  const env = {
    name: process.env.DSH_TASK_GIT_NAME ?? process.env.GIT_AUTHOR_NAME,
    email: process.env.DSH_TASK_GIT_EMAIL ?? process.env.GIT_AUTHOR_EMAIL,
  };
  if (typeof env.name === 'string' && env.name.length > 0 && typeof env.email === 'string' && env.email.length > 0) {
    return { name: env.name, email: env.email };
  }
  return undefined;
}

/** Remove a task directory (used by tests and by `--force` adoption). */
export function removeTask(taskDir) {
  const root = resolve(taskDir);
  const progress = findProgressFile(root);
  if (progress !== undefined) unlinkSync(progress);
  const leftovers = existsSync(root) ? readdirSync(root) : [];
  return leftovers;
}

/** Date suffix of a task folder, or `undefined`. */
export function folderDate(folder) {
  const match = DATE_RE.exec(folder);
  return match === null ? undefined : match[1];
}
