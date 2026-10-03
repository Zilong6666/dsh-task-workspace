/**
 * dsh-task-workspace — a DSH bundle that makes one convention stick:
 *
 *   1. every task gets its own folder in the workspace;
 *   2. every task has exactly one progress file, overwritten on each update
 *      (with the superseded text kept as an auto compaction summary);
 *   3. a task that runs long gets its own git repository.
 *
 * Host half: a system-prompt section (the convention, always visible), three
 * tools (`task_new`, `task_progress`, `task_git`) plus `task_list`, and one
 * registered skill for readers that work from the skill catalog.
 *
 * @module dsh-task-workspace
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
  GIT_TRIGGERS,
  appendChangelog,
  applySummarize,
  createTask,
  findProgressFile,
  gitAuthor,
  gitForTask,
  listTasks,
  looksDone,
  readTask,
  resolveTaskDir,
  resolveWorkspaceRoot,
  setGoal,
  setSection,
} from './store.mjs';
import { INDEX_FILE, applyCleanup, formatBytes, renderIndex, scanWorkspace, writeIndex } from './tidy.mjs';

export const name = 'dsh-task-workspace';

/** Default configuration; a profile may override any key in cordis.patch.yml. */
export const DEFAULTS = {
  enabled: true,
  workspaceRoot: '',
  defaultGit: false,
  autoCommit: true,
  sectionOrder: 61,
  promptEnabled: true,
  skillEnabled: true,
  template: '',
  gitAuthor: { name: '', email: '' },
};

/** `${DSH_HOME}/dsh-task-workspace/config.json`. */
export function configPath() {
  const base = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  return join(base, 'dsh-task-workspace', 'config.json');
}

/** Merge defaults, the on-disk config file, and the live plugin config. */
export function loadConfig(live) {
  const merged = { ...DEFAULTS };
  const file = configPath();
  if (existsSync(file)) {
    try {
      Object.assign(merged, JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      // A corrupt config must never keep the plugin from loading.
    }
  }
  if (live !== undefined && live !== null && typeof live === 'object') {
    for (const [key, value] of Object.entries(live)) {
      if (value === undefined || value === '') continue;
      if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) continue;
      merged[key] = value;
    }
  }
  return merged;
}

/** Persist a partial config (used by the CLI and by `task_new`'s lessons). */
export function saveConfig(patch) {
  const file = configPath();
  mkdirSync(join(file, '..'), { recursive: true });
  const current = loadConfig();
  writeFileSync(file, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, 'utf8');
  return file;
}

/** Tool definition helper: the same shape `defineTool` produces. */
function defineTool(definition) {
  if (typeof definition?.name !== 'string' || definition.name.length === 0) {
    throw new TypeError('a tool definition needs a name');
  }
  if (typeof definition.description !== 'string') {
    throw new TypeError(`tool ${definition.name} needs a description`);
  }
  if (typeof definition.execute !== 'function') {
    throw new TypeError(`tool ${definition.name} needs an execute function`);
  }
  return definition;
}

const text = (value) => [{ type: 'text', text: String(value ?? '') }];

const OUT_TASK = {
  type: 'object',
  additionalProperties: false,
  required: ['dir', 'folder', 'progress_file', 'name', 'created'],
  properties: {
    dir: { type: 'string' },
    folder: { type: 'string' },
    progress_file: { type: 'string' },
    name: { type: 'string' },
    goal: { type: 'string' },
    created: { type: 'boolean' },
    git: { type: 'string', enum: ['initialized', 'skipped', 'unchanged', 'failed'] },
    next_step: { type: 'string' },
  },
};

const OUT_PROGRESS = {
  type: 'object',
  additionalProperties: false,
  required: ['dir', 'progress_file', 'bytes', 'committed'],
  properties: {
    dir: { type: 'string' },
    progress_file: { type: 'string' },
    bytes: { type: 'integer' },
    sections: { type: 'array', items: { type: 'string' } },
    changed: { type: 'array', items: { type: 'string' } },
    committed: { type: 'boolean' },
    git_head: { type: 'string' },
    next_step: { type: 'string' },
  },
};

const OUT_TIDY = {
  type: 'object',
  additionalProperties: false,
  required: [
    'root',
    'index_file',
    'applied',
    'entry_count',
    'task_count',
    'junk_count',
    'stray_count',
    'removed',
    'freed_bytes',
  ],
  properties: {
    root: { type: 'string' },
    index_file: { type: 'string' },
    applied: { type: 'boolean' },
    entry_count: { type: 'integer' },
    task_count: { type: 'integer' },
    junk_count: { type: 'integer' },
    stray_count: { type: 'integer' },
    removed: { type: 'array', items: { type: 'string' } },
    freed_bytes: { type: 'integer' },
    heavy: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * Host plugin entry.
 *
 * `tools` and `systemPrompt` are injected hard: they are core services, and
 * Cordis refuses property access to a non-injected service. The optional
 * services (`skills`, `workspaceRegistry`) are read through `ctx.get()`.
 *
 * @param ctx - the plugin context.
 * @param config - projected Config (see DEFAULTS).
 */
export function apply(ctx, config) {
  const cfg = loadConfig(config);
  if (cfg.enabled === false) return;

  const disposers = [];
  const author = gitAuthor(cfg.gitAuthor);

  const rootFor = (explicit, exec) =>
    resolveWorkspaceRoot(explicit, cfg.workspaceRoot, cwdFor(ctx, exec));

  if (cfg.promptEnabled !== false && typeof ctx.systemPrompt?.section === 'function') {
    disposers.push(
      ctx.systemPrompt.section({
        name: 'task-workspace',
        order: Number.isFinite(cfg.sectionOrder) ? cfg.sectionOrder : DEFAULTS.sectionOrder,
        text: conventionText(cfg),
      }),
    );
  }

  if (typeof ctx.tools?.register === 'function') {
    disposers.push(ctx.tools.register(taskNew(ctx, cfg, rootFor, author)));
    disposers.push(ctx.tools.register(taskProgress(ctx, cfg, rootFor, author)));
    disposers.push(ctx.tools.register(taskGit(ctx, cfg, rootFor, author)));
    disposers.push(ctx.tools.register(taskList(ctx, cfg, rootFor)));
    disposers.push(ctx.tools.register(taskTidy(ctx, cfg, rootFor)));
  }

  const skills = ctx.get?.('skills');
  if (cfg.skillEnabled !== false && typeof skills?.register === 'function') {
    try {
      disposers.push(
        skills.register({
          name: 'task-workspace-convention',
          description:
            'How to run long tasks in this workspace: one folder per task, one overwritten PROGRESS.md per task, its own git repo once the task runs long.',
          whenToUse:
            'Use at the start of any multi-step task, any task that produces several files, or any task that may span sessions.',
          content: skillBody(cfg),
          provider: name,
          resourceBase: { kind: 'opaque', description: 'dsh-task-workspace bundle' },
        }),
      );
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] skill registration failed: ${String(error)}`);
    }
  }

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {
        // Disposal is best effort.
      }
    }
  };
}

/**
 * Cordis dependency declaration: hard dependencies only.
 *
 * The loader normalizes module shapes with `exports.default ?? exports`
 * (cordis-plugin-loader `unwrapExports`), so a bare namespace `inject` export is
 * dropped the moment a plugin has a default export. The declaration therefore
 * has to hang off the exported value as a property — otherwise `ctx.systemPrompt`
 * throws `cannot get property "systemPrompt" without inject`.
 */
const inject = ['tools', 'systemPrompt'];

apply.inject = inject;
export { inject };
export default apply;

/** The convention, as prompt/skill text. */
export function conventionText(cfg = DEFAULTS) {
  const trigger = GIT_TRIGGERS.join('；');
  return [
    '## 任务工作区约定（task-workspace 插件强制）',
    '',
    '处理任何多步骤任务时按此执行：',
    '',
    '1. **开工先建目录**：调用 `task_new` 建 `<任务名>-<YYYYMMDD>/`（插件自动放在工作区根目录）。',
    '2. **唯一进度文件**：每个任务只有一个 `PROGRESS.md`；每次有实质进展就调用 `task_progress` **整体覆盖更新**它，并把当次改动写入「变更日志」。',
    '3. **过长即建 git**：满足任一条件（' +
      trigger +
      '）就调用 `task_git` 在该任务目录内初始化仓库并提交。',
    '4. **回填**：任务收尾时把结论写进「当前进度」与「产出物」，让后来者只读 `PROGRESS.md` 就能接手。',
    '',
    '任务目录直接位于工作区根目录，不放 `tasks/` 之类的中间层。',
    cfg.defaultGit === true ? '当前配置为所有新任务默认建 git 仓库。' : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Skill/project directory, decoded from the module URL (handles spaces in paths). */
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

/** The skill body: the packaged SKILL.md when present, otherwise the prompt text. */
export function skillBody(cfg = DEFAULTS) {
  const file = join(PACKAGE_DIR, 'skills', 'task-workspace', 'SKILL.md');
  try {
    if (existsSync(file)) {
      const body = readFileSync(file, 'utf8');
      if (body.trim().length > 0) return body;
    }
  } catch {
    // Fall through to the generated text.
  }
  return conventionText(cfg);
}

/** Best-effort session cwd: workspace registry, live agent, then the session log header. */
function cwdFor(ctx, exec) {
  const sessionId = exec?.agent?.id;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined;

  try {
    const registry = ctx.get?.('workspaceRegistry');
    if (registry !== undefined && typeof registry.list === 'function') {
      for (const workspace of registry.list()) {
        if (Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId)) {
          if (typeof workspace.path === 'string' && workspace.path.length > 0) return workspace.path;
        }
      }
    }
  } catch {
    // Fall through to the live agent.
  }

  try {
    const agent = ctx.get?.('agents')?.get?.(sessionId);
    for (const candidate of [
      agent?.cwd,
      agent?.session?.cwd,
      agent?.session?.header?.cwd,
      agent?.meta?.cwd,
      agent?.options?.cwd,
    ]) {
      if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }
  } catch {
    // Fall through to the session log.
  }

  return sessionCwdFromLog(sessionId);
}

/**
 * Read the session header out of its own log. The log is a concatenation of
 * zstd frames, so only the first frame carries the `session` record.
 */
function sessionCwdFromLog(sessionId) {
  const home = process.env.DSH_HOME;
  if (typeof home !== 'string' || home.length === 0) return undefined;
  const root = join(home, 'sessions');
  let buckets;
  try {
    buckets = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return undefined;
  }
  for (const bucket of buckets) {
    for (const name of ['session.v4.jsonl.zstd', 'session.jsonl.zstd']) {
      const file = join(root, bucket.name, sessionId, name);
      try {
        if (!existsSync(file)) continue;
        const buf = readFileSync(file).subarray(0, 1 << 20);
        const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
        const next = buf.indexOf(magic, 4);
        const frame = next === -1 ? buf : buf.subarray(0, next);
        const text = zlib.zstdDecompressSync(frame).toString('utf8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.length === 0) continue;
          let record;
          try {
            record = JSON.parse(trimmed);
          } catch {
            continue;
          }
          if (record?.type === 'session' && typeof record.cwd === 'string' && record.cwd.length > 0) {
            return record.cwd;
          }
        }
      } catch {
        // Try the next candidate file.
      }
    }
  }
  return undefined;
}

/** Find an existing task by directory, or by a name/goal/folder substring. */
function findTask(root, { taskDir, task_dir, task }) {
  const explicit = typeof taskDir === 'string' && taskDir.trim().length > 0 ? taskDir : task_dir;
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    const dir = resolveTaskDir(explicit, root);
    return readTask(dir) ?? { dir, folder: dir.split('/').at(-1), progressFile: join(dir, 'PROGRESS.md') };
  }
  const query = typeof task === 'string' ? task.trim().toLowerCase() : '';
  if (query.length === 0) {
    throw new Error('pass task_dir, or task=<name/substring of an existing task>');
  }
  const tasks = listTasks(root);
  const hits = tasks.filter((entry) =>
    [entry.folder, entry.name, entry.goal].some((field) => field.toLowerCase().includes(query)),
  );
  if (hits.length === 0) {
    throw new Error(`no task in ${root} matches "${task}"`);
  }
  if (hits.length > 1) {
    const exact = hits.find((entry) => entry.folder.toLowerCase() === query);
    if (exact === undefined) {
      throw new Error(
        `"${task}" matches ${hits.length} tasks: ${hits.map((entry) => entry.folder).join(', ')} — pass task_dir`,
      );
    }
    return exact;
  }
  return hits[0];
}

/** `task_new` — folder + PROGRESS.md (+ optional git). */
function taskNew(ctx, cfg, rootFor, author) {
  return defineTool({
    name: 'task_new',
    description:
      'Start a task the workspace way: create <workspace>/<name>-<YYYYMMDD>/ with exactly one PROGRESS.md, and optionally its own git repository. Call this once at the beginning of any multi-step task, before writing other files.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Task name, e.g. "竞品调研" or "ETL refactor".' },
        goal: { type: 'string', description: 'One-sentence goal recorded in PROGRESS.md.' },
        slug: { type: 'string', description: 'Override the folder slug when the name is long or non-ASCII-heavy.' },
        force: {
          type: 'boolean',
          description: 'Adopt an existing non-empty folder of the same name instead of failing.',
        },
        init_git: {
          type: 'boolean',
          description: 'Also run git init + the first commit in the task folder (long tasks do this at creation time).',
        },
      },
      required: ['name'],
    },
    output: {
      schema: OUT_TASK,
      render: (_args, value) =>
        text(
          `${value.created === true ? '已创建' : '已存在'}任务目录：${value.dir}\n进度文件：${value.progress_file}` +
            (value.git !== undefined && value.git !== 'skipped' ? `\ngit：${value.git}` : '') +
            `\n下一步：${value.next_step ?? ''}`,
        ),
      presentationMeta: (_args, value) => {
        const result = {};
        if (typeof value.folder === 'string') result.task = value.folder;
        if (typeof value.dir === 'string') result.path = value.dir;
        return result;
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const root = rootFor(args.workspace, exec);
      const { task, created } = createTask({
        root,
        name: args.name,
        goal: args.goal ?? '',
        slug: args.slug,
        force: args.force === true,
        template: typeof cfg.template === 'string' && cfg.template.length > 0 ? cfg.template : undefined,
      });
      let gitState = 'skipped';
      if (args.init_git === true || cfg.defaultGit === true) {
        try {
          const result = gitForTask(task.dir, { author });
          gitState = result.initialized ? 'initialized' : 'unchanged';
        } catch (error) {
          gitState = 'failed';
          ctx.logger?.warn?.(
            `[${name}] git init failed for ${task.dir}: ${String(error?.message ?? error)} ${String(error?.stderr ?? '')}`,
          );
        }
      }
      return {
        dir: task.dir,
        folder: task.folder,
        progress_file: task.progressFile,
        name: task.name,
        goal: task.goal,
        created,
        git: gitState,
        next_step:
          created === true
            ? '开始工作；每次有实质进展时用 task_progress 覆盖更新 PROGRESS.md。'
            : '目录已存在，直接继续；用 task_progress 更新进度。',
      };
    },
  });
}

/** `task_progress` — overwrite the single progress file (+ optional commit). */
function taskProgress(ctx, cfg, rootFor, author) {
  return defineTool({
    name: 'task_progress',
    description:
      "Update a task's single PROGRESS.md (whole-file overwrite, not append): set the current-progress summary, append today's change to the changelog, optionally set status/next/deliverables/goal, then optionally commit. Call it whenever real progress happened, and always before ending a long task.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task_dir: { type: 'string', description: 'Task folder (absolute, or relative to the workspace root).' },
        task: { type: 'string', description: 'Alternative selector: name/spoken substring of an existing task.' },
        summary: {
          type: 'string',
          description:
            'New content of the "当前进度" section. The prior summary text is kept as an auto compaction summary inside that section.',
        },
        changelog: { type: 'string', description: 'One line for the changelog, e.g. "完成数据抓取，产出 data.csv".' },
        status: { type: 'string', description: 'New "状态" value: 进行中 / 阻塞 / 已完成 …' },
        next: { type: 'string', description: 'New "下一步" list, one item per line.' },
        deliverables: { type: 'string', description: 'New "产出物" list, one item per line, paths included.' },
        goal: { type: 'string', description: 'Rewrite the goal (rarely needed).' },
        commit: {
          type: 'boolean',
          description: 'Commit with git when the task folder already has a repository (default: config autoCommit).',
        },
        message: { type: 'string', description: 'Commit message override.' },
      },
    },
    output: {
      schema: OUT_PROGRESS,
      render: (_args, value) =>
        text(
          `已覆盖更新 ${value.progress_file}（${value.bytes} 字节）` +
            (value.changed.length > 0 ? `\n改动：${value.changed.join('、')}` : '') +
            (value.committed === true ? `\ngit：已提交 ${value.git_head ?? ''}` : ''),
        ),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const root = rootFor(args.workspace, exec);
      const task = findTask(root, args);
      const progressFile = findProgressFile(task.dir) ?? task.progressFile;
      if (!existsSync(progressFile)) {
        throw new Error(`no progress file in ${task.dir}; create the task with task_new first`);
      }
      let content = readFileSync(progressFile, 'utf8');
      const changed = [];

      if (typeof args.goal === 'string' && args.goal.trim().length > 0) {
        content = setGoal(content, args.goal.trim());
        changed.push('目标');
      }
      if (typeof args.summary === 'string' && args.summary.trim().length > 0) {
        content = applySummarize(content, args.summary, { maxLines: 18 }).content;
        changed.push('当前进度');
      }
      if (typeof args.status === 'string' && args.status.trim().length > 0) {
        content = setSection(content, '状态', args.status.trim());
        changed.push('状态');
      }
      if (typeof args.next === 'string' && args.next.trim().length > 0) {
        content = setSection(content, '下一步', listBody(args.next));
        changed.push('下一步');
      }
      if (typeof args.deliverables === 'string' && args.deliverables.trim().length > 0) {
        content = setSection(content, '产出物', listBody(args.deliverables));
        changed.push('产出物');
      }
      if (typeof args.changelog === 'string' && args.changelog.trim().length > 0) {
        content = appendChangelog(content, args.changelog);
        changed.push('变更日志');
      }
      if (changed.length === 0) {
        throw new Error('nothing to update: pass summary / changelog / status / next / deliverables / goal');
      }

      writeFileSync(progressFile, content, 'utf8');
      const current = readTask(task.dir);
      const shouldCommit = args.commit ?? cfg.autoCommit !== false;
      let committed = false;
      let head;
      if (shouldCommit === true && current !== undefined && current.hasGit) {
        try {
          const result = gitForTask(task.dir, { author, message: args.message, init: false });
          committed = result.committed;
          head = result.head;
        } catch (error) {
          ctx.logger?.warn?.(`[${name}] commit failed for ${task.dir}: ${String(error)}`);
        }
      }
      return {
        dir: task.dir,
        progress_file: progressFile,
        bytes: Buffer.byteLength(content, 'utf8'),
        sections: [...content.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)].map((match) => match[1].trim()),
        changed,
        committed,
        git_head: head,
        next_step: looksDone(content, args.summary ?? '')
          ? '任务看起来已完成：把产出物补齐后结束。'
          : '继续推进；下次有进展再调用 task_progress。',
      };
    },
  });
}

function listBody(value) {
  return String(value)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => (line.startsWith('-') ? line : `- ${line}`))
    .join('\n');
}

/** `task_git` — per-task repository. */
function taskGit(ctx, cfg, rootFor, author) {
  return defineTool({
    name: 'task_git',
    description:
      "Give one task its own git repository: git init (with .gitignore) + commit, or just commit the current state. Use it when a task runs long (more than ~3 turns, across sessions, or more than ~10 produced files).",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task_dir: { type: 'string', description: 'Task folder (absolute, or relative to the workspace root).' },
        task: { type: 'string', description: 'Alternative selector: name/substring of an existing task.' },
        message: { type: 'string', description: 'Commit message (default: chore/progress message).' },
        commit: { type: 'boolean', description: 'Commit after init (default true).' },
      },
      required: [],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string' },
          initialized: { type: 'boolean' },
          committed: { type: 'boolean' },
          changes: { type: 'array', items: { type: 'string' } },
          head: { type: 'string' },
        },
      },
      render: (_args, value) =>
        text(
          `${value.initialized === true ? '已初始化' : '已存在'}仓库：${value.dir}/.git` +
            (value.committed === true ? `\n已提交：${value.head}` : '\n无改动需要提交') +
            (value.changes.length > 0 ? `\n文件：${value.changes.slice(0, 20).join(', ')}` : ''),
        ),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const root = rootFor(args.workspace, exec);
      const task = findTask(root, args);
      if (!existsSync(task.dir)) throw new Error(`task directory does not exist: ${task.dir}`);
      const result = gitForTask(task.dir, {
        author,
        message: args.message,
        init: true,
      });
      if (args.commit === false && result.committed === true) {
        // The caller only wanted the repository to exist.
        return { ...result, committed: false };
      }
      return result;
    },
  });
}

/** `task_list` — what exists in this workspace. */
function taskList(ctx, cfg, rootFor) {
  return defineTool({
    name: 'task_list',
    description: 'List the task workspaces already present in this workspace (folder, goal, status, progress).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', description: 'Maximum number of tasks to return (default 20).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['root', 'count'],
        properties: {
          root: { type: 'string' },
          count: { type: 'integer' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['dir', 'name'],
              properties: {
                dir: { type: 'string' },
                name: { type: 'string' },
                goal: { type: 'string' },
                status: { type: 'string' },
                updated_at: { type: 'string' },
                git: { type: 'boolean' },
              },
            },
          },
        },
      },
      render: (_args, value) =>
        text(
          value.count === 0
            ? `${value.root} 下还没有任务目录。`
            : value.tasks
                .map(
                  (entry) =>
                    `- ${entry.name}（${entry.dir}）${entry.status.length > 0 ? ` — ${entry.status}` : ''}` +
                    (entry.git === true ? ' [git]' : ''),
                )
                .join('\n'),
        ),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const root = rootFor(args.workspace, exec);
      const limit = Number.isFinite(args.limit) ? Math.max(1, Number(args.limit)) : 20;
      const tasks = listTasks(root).slice(0, limit);
      return {
        root,
        count: tasks.length,
        tasks: tasks.map((entry) => ({
          dir: entry.dir,
          name: entry.name,
          goal: entry.goal,
          status: entry.status,
          updated_at: entry.updatedAt,
          git: entry.hasGit,
        })),
      };
    },
  });
}

/**
 * `task_tidy` — index the workspace and clear out provably disposable files.
 *
 * Dry run by default: the tool reports what it would delete and only removes
 * anything when `apply: true`. The index file is (re)written either way.
 */
function taskTidy(ctx, cfg, rootFor) {
  return defineTool({
    name: 'task_tidy',
    description:
      'Tidy the workspace: classify every top-level entry (task / output / intermediate / tooling), rewrite the index file, and clear OS litter, caches, stale backups, packed tarballs and stray task folders. Dry run unless apply=true.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspace: { type: 'string', description: 'Workspace root; defaults to the session workspace.' },
        apply: {
          type: 'boolean',
          description: 'Actually delete the safe candidates (default false: report only).',
        },
        index: { type: 'boolean', description: 'Write/refresh the index file (default true).' },
        index_file: { type: 'string', description: `Index file name (default ${INDEX_FILE}).` },
      },
    },
    output: {
      schema: OUT_TIDY,
      render: (_args, value) => {
        const lines = [
          `${value.root}：${value.entry_count} 个顶层条目，其中任务 ${value.task_count} 个。`,
          value.applied
            ? `已清理 ${value.removed.length} 项，释放 ${formatBytes(value.freed_bytes)}。`
            : `待清理 ${value.removed.length} 项（dry run，未删除）。`,
        ];
        if (value.index_file.length > 0) lines.push(`索引：${value.index_file}`);
        if (value.removed.length > 0) {
          lines.push(
            ...value.removed.slice(0, 20).map((item) => `- ${item}`),
            ...(value.removed.length > 20 ? [`- …其余 ${value.removed.length - 20} 项`] : []),
          );
        }
        if (value.heavy.length > 0) {
          lines.push(...value.heavy.map((item) => `大体积中间产物（未动）：${item}`));
        }
        if (value.warnings.length > 0) lines.push(...value.warnings.map((item) => `警告：${item}`));
        return text(lines.join('\n'));
      },
    },
    async execute(args, exec) {
      const root = rootFor(args.workspace, exec);
      const scan = scanWorkspace(root);
      const dryRun = args.apply !== true;
      const { removed, warnings, freed_bytes } = applyCleanup(scan, { dryRun });
      let indexFile = '';
      if (args.index !== false) {
        indexFile = writeIndex(root, renderIndex(scan, { removed: dryRun ? [] : removed }), {
          file: typeof args.index_file === 'string' && args.index_file.length > 0 ? args.index_file : INDEX_FILE,
        });
      }
      return {
        root,
        index_file: indexFile,
        applied: !dryRun,
        entry_count: scan.totals.entries,
        task_count: scan.totals.tasks,
        junk_count: scan.junk.length,
        stray_count: scan.strays.length,
        removed: removed.map((item) => item.rel),
        freed_bytes,
        heavy: scan.totals.heavy.map((entry) => `${entry.name}（${formatBytes(entry.bytes)}）`),
        warnings,
      };
    },
  });
}

export { resolveWorkspaceRoot, resolveTaskDir, listTasks, createTask, gitForTask };
