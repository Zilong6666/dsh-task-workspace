/**
 * dsh-task-workspace self test — no test framework, no network, no model.
 *
 *   node test/run.mjs            # unit + plugin wiring + real git
 *   node test/run.mjs --keep     # keep the temporary workspace for inspection
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import zlibDefault from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';

const keep = process.argv.includes('--keep');
const HOME_DIR = mkdtempSync(join(tmpdir(), 'dsh-task-home-'));
const WORK_DIR = mkdtempSync(join(tmpdir(), 'dsh-task-work-'));
process.env.DSH_HOME = HOME_DIR;
process.env.DSH_TASK_WORKSPACE_ROOT = WORK_DIR;
process.env.DSH_TASK_GIT_NAME = 'dsh-task-workspace test';
process.env.DSH_TASK_GIT_EMAIL = 'test@example.invalid';

const store = await import('../src/store.mjs');
const plugin = await import('../src/index.mjs');

let passed = 0;
const failures = [];
function check(label, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok   ${label}\n`);
  } catch (error) {
    failures.push({ label, error });
    process.stdout.write(`  FAIL ${label}\n         ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
async function checkAsync(label, fn) {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`  ok   ${label}\n`);
  } catch (error) {
    failures.push({ label, error });
    process.stdout.write(`  FAIL ${label}\n         ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

/** Minimal ctx stub mirroring the real registries closely enough to catch wiring bugs. */
function stubCtx({ withSkills = true, withRegistry = false } = {}) {
  const state = { sections: [], tools: new Map(), skills: [], disposed: 0 };
  const disposer = (what) => () => {
    state.disposed += 1;
    if (what !== undefined) what();
  };
  const ctx = {
    logger: { warn: (...a) => process.stdout.write(`      [warn] ${a.join(" ")}\n`), info: () => {} },
    systemPrompt: {
      section(section) {
        state.sections.push(section);
        return disposer(() => state.sections.splice(state.sections.indexOf(section), 1));
      },
    },
    tools: {
      register(definition) {
        if (state.tools.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`);
        state.tools.set(definition.name, definition);
        return disposer(() => state.tools.delete(definition.name));
      },
    },
    get(key) {
      if (key === 'workspaceRegistry' && withRegistry) return { list: () => [{ path: WORK_DIR, sessionIds: ['s1'] }] };
      if (key === 'skills' && withSkills) return skillRegistry;
      return undefined;
    },
  };
  const skillRegistry = {
    register(skill) {
      state.skills.push(skill);
      return disposer();
    },
  };
  return { ctx, state };
}

function callTool(tool, args, sessionId = 's1') {
  return tool.execute(args, {
    callId: 'test',
    name: tool.name,
    arguments: args,
    signal: new AbortController().signal,
    agent: { id: sessionId },
  });
}

process.stdout.write(`dsh-task-workspace self test\nwork=${WORK_DIR}\nhome=${HOME_DIR}\n\n`);

// ---------------------------------------------------------------- unit: store
process.stdout.write('store\n');
check('slugify keeps CJK, drops shell-unsafe characters', () => {
  assert.equal(store.slugify('DSH 插件：任务/工作区 (v2)'), 'DSH-插件-任务-工作区-v2');
  assert.equal(store.slugify('   ..//  '), 'task');
});
check('taskFolderName appends the compact date once', () => {
  assert.equal(store.taskFolderName('调研', '20261002'), '调研-20261002');
  assert.equal(store.taskFolderName('调研-20261002', '20261002'), '调研-20261002');
});
check('localDate/compactDate honour the +08:00 offset', () => {
  const now = new Date('2026-10-02T17:30:00Z');
  assert.equal(store.localDate(480, now), '2026-10-03');
  assert.equal(store.compactDate(480, now), '20261003');
});
check('resolveWorkspaceRoot refuses node_modules and creates an explicit root', () => {
  const bad = join(HOME_DIR, 'x/node_modules/y');
  assert.throws(() => store.resolveWorkspaceRoot(bad, undefined, WORK_DIR), /refusing to use/);
  const fresh = join(WORK_DIR, 'fresh-root');
  assert.equal(store.resolveWorkspaceRoot(fresh, undefined, WORK_DIR), fresh);
  assert.ok(existsSync(fresh), 'an explicit root is created on demand');
});
check('resolveWorkspaceRoot falls back to cwd when nothing else is usable', () => {
  assert.equal(store.resolveWorkspaceRoot(undefined, undefined, WORK_DIR), WORK_DIR);
});
check('renderProgress substitutes every placeholder', () => {
  const rendered = store.renderProgress({ taskName: 'T', goal: 'G', dir: '/d', date: '2026-10-02' });
  assert.match(rendered, /^# T$/m);
  assert.ok(!rendered.includes('{{'));
  assert.ok(rendered.includes('`/d/PROGRESS.md`'));
});
check('chunkLines keeps every line', () => {
  const input = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
  assert.equal(store.chunkLines(input, 18).join('\n'), input);
});

// ------------------------------------------------------- unit: progress rewrite
const template = store.renderProgress({ taskName: 'T', goal: 'G', dir: '/d', date: '2026-10-02' });
check('appendChangelog replaces the placeholder line', () => {
  const next = store.appendChangelog(template, '完成数据抓取');
  assert.ok(next.includes('- 完成数据抓取'));
  assert.equal(next.match(/待补充。/g).length, 2);
});
check('setSection + appendToSection keep one section each', () => {
  let next = store.setSection(template, '状态', '阻塞');
  next = store.appendToSection(next, '变更日志', '第二次更新');
  assert.equal(next.match(/^## 状态$/gm).length, 1);
  assert.equal(next.match(/^## 变更日志$/gm).length, 1);
  assert.ok(next.includes('- 第二次更新'));
});
check('every update leaves well-formed markdown (blank line between blocks)', () => {
  let text = store.appendChangelog(store.appendChangelog(template, '第一次'), '第二次');
  text = store.setSection(text, '状态', '阻塞');
  assert.match(text, /- 2026-10-02 建立任务工作区。\n- 第一次\n- 第二次/, 'changelog stays a tight list');
  assert.equal(text.match(/^## /gm).length, 6);
  assert.match(text, /阻塞\n\n## 当前进度/, 'setSection keeps the blank line before the next heading');
});
check('applySummarize compacts a long summary and archives the original', () => {
  const long = Array.from({ length: 40 }, (_, i) => `第 ${i} 项进展`).join('\n');
  const { content, chunks } = store.applySummarize(template, long);
  assert.equal(chunks.length, 3);
  assert.ok(content.includes('### 进度历史（压缩摘要）'));
  assert.ok(content.includes('第 0 项进展'));
  assert.ok(content.includes('第 39 项进展'));
});
check('applySummarize on a short summary keeps the section clean', () => {
  const { content } = store.applySummarize(template, '做完了 A 和 B');
  assert.equal(content.match(/^### 进度历史/m), null);
  assert.ok(content.includes('做完了 A 和 B'));
});
check('looksDone detects Chinese and English finished states', () => {
  assert.equal(store.looksDone(store.setSection(template, '状态', '已完成')), true);
  assert.equal(store.looksDone(template, 'work done'), true);
  assert.equal(store.looksDone(template, 'still going'), false);
});

// ------------------------------------------------------------ end-to-end: plugin
process.stdout.write('\nplugin\n');
const { ctx, state } = stubCtx();
const dispose = plugin.default(ctx, {});
check('registers one prompt section', () => assert.equal(state.sections.length, 1));
check('registers five tools', () => assert.equal(state.tools.size, 5));
check('prompt section states the convention', () => {
  const text = state.sections[0].text;
  assert.ok(text.includes('任务工作区约定'));
  assert.ok(text.includes('PROGRESS.md'));
  assert.ok(text.includes('task_git'));
});

const taskNew = state.tools.get('task_new');
const taskProgress = state.tools.get('task_progress');
const taskGit = state.tools.get('task_git');
const taskList = state.tools.get('task_list');
const taskTidy = state.tools.get('task_tidy');

// The host rejects a tool schema outside its enforced subset at registration
// time (dsh-tools `assertSupportedJsonSchema`), which real boot once caught only
// after install. Mirror the subset here: `required` is an object-level keyword,
// never a per-property flag.
const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
const KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title']);
const ANNOTATION_ONLY = new Set(['description', 'title']);
function schemaViolations(node, path = 'schema', out = []) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    out.push(`${path} must be a schema object`);
    return out;
  }
  for (const key of Object.keys(node)) if (!KEYWORDS.has(key)) out.push(`${path}.${key} is not a supported keyword`);
  const type = node.type;
  if (typeof type !== 'string' || !SCHEMA_TYPES.includes(type)) {
    if (!KEYWORDS.has('type')) out.push(`${path} must declare type`);
    return out;
  }
  for (const [key, ok] of [
    ['properties', 'object'],
    ['required', 'object'],
    ['additionalProperties', 'object'],
    ['items', 'array'],
  ]) {
    if (Object.hasOwn(node, key) && type !== ok) out.push(`${path}.${key} is not supported on type "${type}"`);
  }
  if (type === 'object') {
    for (const [name, child] of Object.entries(node.properties ?? {})) schemaViolations(child, `${path}.properties.${name}`, out);
    if (Object.hasOwn(node, 'required')) {
      if (!Array.isArray(node.required) || node.required.some((entry) => typeof entry !== 'string')) {
        out.push(`${path}.required must be an array of strings`);
      }
    }
  } else if (type === 'array' && Object.hasOwn(node, 'items')) {
    schemaViolations(node.items, `${path}.items`, out);
  }
  void ANNOTATION_ONLY;
  return out;
}

check('tool output schemas stay inside the host JSON Schema subset', () => {
  for (const tool of state.tools.values()) {
    const problems = schemaViolations(tool.output.schema, `${tool.name}.output.schema`);
    assert.deepEqual(problems, [], `${tool.name}: ${problems.join('; ')}`);
  }
});

check('tool parameter specs are {type, required?, description} records', () => {
  for (const tool of state.tools.values()) {
    const spec = tool.parameters ?? {};
    assert.equal(spec.type, 'object', `${tool.name}.parameters must be an object schema`);
    for (const [arg, info] of Object.entries(spec.properties ?? {})) {
      assert.ok(typeof info.type === 'string', `${tool.name}.${arg} needs a type`);
      assert.ok(
        info.required === undefined || typeof info.required === 'boolean',
        `${tool.name}.${arg}.required must be a boolean flag`,
      );
      assert.ok(typeof info.description === 'string', `${tool.name}.${arg} needs a description`);
    }
    for (const name of spec.required ?? []) {
      assert.ok(name in (spec.properties ?? {}), `${tool.name}.required names unknown argument ${name}`);
    }
  }
});

check('registered tool names are snake_case and unique', () => {
  for (const name of state.tools.keys()) assert.match(name, /^[a-z][a-z0-9_]*$/);
});

let created;
await checkAsync('task_new creates <slug>-<date>/PROGRESS.md', async () => {
  created = await callTool(taskNew, { name: '端到端测试', goal: '验证三个工具能串起来' });
  assert.equal(created.created, true);
  assert.match(created.folder, /^端到端测试-\d{8}$/);
  assert.equal(created.dir, join(WORK_DIR, created.folder));
  assert.ok(existsSync(created.progress_file));
});

await checkAsync('task_new is idempotent for the same day', async () => {
  const again = await callTool(taskNew, { name: '端到端测试', goal: '验证三个工具能串起来' });
  assert.equal(again.created, false);
  assert.equal(again.dir, created.dir);
});

await checkAsync('task_progress overwrites the summary and appends the changelog', async () => {
  const result = await callTool(taskProgress, {
    task_dir: created.dir,
    summary: '抓到 1200 条数据',
    changelog: '完成抓取',
    status: '进行中',
    next: '清洗数据\n写报告',
    deliverables: 'data/raw.csv',
  });
  assert.deepEqual(result.changed, ['当前进度', '状态', '下一步', '产出物', '变更日志']);
  const body = readFileSync(result.progress_file, 'utf8');
  assert.ok(body.includes('抓到 1200 条数据'));
  assert.ok(body.includes('- 完成抓取'));
  assert.ok(body.includes('- 写报告'));
  assert.ok(body.includes('- data/raw.csv'));
  assert.equal(body.match(/建立任务工作区/g).length, 1, 'changelog keeps history');
});

await checkAsync('task_progress selects a task by spoken name', async () => {
  const result = await callTool(taskProgress, { task: '端到端', changelog: '按名字选中任务' });
  assert.equal(result.dir, created.dir);
});

await checkAsync('task_progress refuses an empty update', async () => {
  await assert.rejects(() => callTool(taskProgress, { task_dir: created.dir }), /nothing to update/);
});

await checkAsync('task_git initializes a repository and commits', async () => {
  const result = await callTool(taskGit, { task_dir: created.dir, message: 'chore: 初始化任务仓库' });
  assert.equal(result.initialized, true);
  assert.equal(result.committed, true);
  assert.ok(existsSync(join(created.dir, '.git')));
  assert.ok(result.head.includes('chore: 初始化任务仓库'));
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: created.dir, encoding: 'utf8' });
  assert.equal(status.trim(), '', 'worktree clean after commit');
});

await checkAsync('task_progress auto-commits inside a task repository', async () => {
  const result = await callTool(taskProgress, { task_dir: created.dir, changelog: '第二次提交' });
  assert.equal(result.committed, true);
  const log = execFileSync('git', ['log', '--pretty=%s'], { cwd: created.dir, encoding: 'utf8' });
  assert.match(log, /progress: 更新进度文件/);
});

await checkAsync('task_list reports the task', async () => {
  const result = await callTool(taskList, {});
  assert.equal(result.root, WORK_DIR);
  assert.equal(result.count, 1);
  assert.equal(result.tasks[0].git, true);
});

await checkAsync('a second session gets its own folder and index entry', async () => {
  const second = await callTool(taskNew, { name: 'Second Task', goal: 'g', init_git: true }, 's2');
  assert.match(second.folder, /^Second-Task-\d{8}$/);
  assert.equal(second.git, 'initialized');
  assert.equal(second.reused, false);
  const listed = await callTool(taskList, {});
  assert.equal(listed.count, 2);
  const index = JSON.parse(readFileSync(join(WORK_DIR, '.dsh-tasks.json'), 'utf8'));
  assert.equal(Object.keys(index.tasks).length, 2);
});

await checkAsync('task_new reuses the folder this session already owns', async () => {
  const first = await callTool(taskNew, { name: '复用测试', goal: '第一轮' }, 's3');
  assert.equal(first.created, true);
  assert.equal(first.reused, false);
  assert.ok(existsSync(join(first.dir, '.dsh-session.json')), 'the folder records its owning session');
  const again = await callTool(taskNew, { name: '复用测试第二阶段', goal: '第二轮' }, 's3');
  assert.equal(again.reused, true);
  assert.equal(again.created, false);
  assert.equal(again.dir, first.dir, 'one session never gets a second folder');
  assert.equal(again.folder, first.folder, 'the original folder name is kept');
  assert.equal(existsSync(join(first.dir, 'PROGRESS.md')), true);
  assert.equal(readFileSync(join(first.dir, 'PROGRESS.md'), 'utf8').includes('复用测试第二阶段'), false);
  const listed = await callTool(taskList, {});
  assert.equal(listed.count, 3, 'the reuse added no folder and no index entry');
});

await checkAsync('a fresh session still gets a new folder', async () => {
  const other = await callTool(taskNew, { name: '会话隔离测试', goal: 'g' }, 's4');
  assert.equal(other.created, true);
  assert.equal(other.reused, false);
  assert.match(other.folder, /^会话隔离测试-\d{8}$/);
});

check('findTaskBySession reads the marker and ignores other sessions', () => {
  assert.equal(store.readSessionMarker(created.dir).sessionId, 's1');
  assert.equal(store.findTaskBySession(WORK_DIR, 's1').dir, created.dir);
  assert.equal(store.findTaskBySession(WORK_DIR, 'nobody'), undefined);
});

await checkAsync('the session marker stays out of a task repository', async () => {
  const made = await callTool(taskNew, { name: 'marker-git', goal: 'g', init_git: true }, 's5');
  assert.ok(existsSync(join(made.dir, '.dsh-session.json')));
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: made.dir, encoding: 'utf8' });
  assert.equal(status.trim(), '', 'the marker is excluded, not committed');
  const tracked = execFileSync('git', ['ls-files'], { cwd: made.dir, encoding: 'utf8' });
  assert.equal(tracked.includes('.dsh-session.json'), false);
  assert.ok(readFileSync(join(made.dir, '.gitignore'), 'utf8').includes('.dsh-session.json'));
  const reused = await callTool(taskNew, { name: 'marker-git again', goal: 'g' }, 's5');
  assert.equal(reused.reused, true);
  assert.equal(reused.dir, made.dir);
});

check('findTaskBySession falls back to the workspace index', () => {
  const root = join(WORK_DIR, '索引回退');
  mkdirSync(root, { recursive: true });
  const made = store.createTask({ root, name: '索引任务', goal: 'g', sessionId: 's-index' });
  rmSync(join(made.task.dir, '.dsh-session.json'));
  assert.equal(store.findTaskBySession(root, 's-index').dir, made.task.dir);
  assert.equal(store.findTaskBySession(root, 'other'), undefined);
});

await checkAsync('task_git on a missing folder fails cleanly', async () => {
  await assert.rejects(() => callTool(taskGit, { task_dir: join(WORK_DIR, 'nope') }), /does not exist/);
});

// ------------------------------------------------------------------------- tidy
process.stdout.write('\ntidy\n');
const tidy = await import('../src/tidy.mjs');

check('scanWorkspace classifies tasks, outputs, caches, tooling and config', () => {
  const root = join(WORK_DIR, '整理测试');
  mkdirSync(join(root, '有任务'), { recursive: true });
  writeFileSync(join(root, '有任务', 'PROGRESS.md'), '# 有任务\n\n- 目标：把东西整理好\n\n## 状态\n\n进行中\n');
  mkdirSync(join(root, '产出'), { recursive: true });
  writeFileSync(join(root, '产出', 'README.md'), '# 产出\n');
  mkdirSync(join(root, 'graphflow-out'), { recursive: true });
  writeFileSync(join(root, 'graphflow-out', 'graph.json'), '{}');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, '.github'), { recursive: true });
  writeFileSync(join(root, '说明.md'), '# 说明\n');
  const scan = tidy.scanWorkspace(root, { home: HOME_DIR });
  const byName = Object.fromEntries(scan.entries.map((entry) => [entry.name, entry]));
  assert.equal(byName['有任务'].category, '任务');
  assert.equal(byName['有任务'].goal, '把东西整理好');
  assert.equal(byName['产出'].category, '产出');
  assert.equal(byName['graphflow-out'].category, '中间产物');
  assert.equal(byName['scripts'].category, '工具');
  assert.equal(byName['.github'].category, '配置');
  assert.equal(byName['说明.md'].category, '文档');
  assert.equal(scan.totals.tasks, 1);
});

check('collectJunk finds OS litter, caches, backups and empty folders only', () => {
  const root = join(WORK_DIR, '垃圾测试');
  mkdirSync(join(root, 'sub', '__pycache__'), { recursive: true });
  mkdirSync(join(root, 'sub', '空', '更空'), { recursive: true });
  writeFileSync(join(root, '.DS_Store'), 'x');
  writeFileSync(join(root, 'sub', '__pycache__', 'm.cpython-311.pyc'), 'x');
  writeFileSync(join(root, 'sub', 'notes.md.bak'), 'x');
  writeFileSync(join(root, 'sub', 'keep.md'), '# keep\n');
  const junk = tidy.collectJunk(root);
  const rels = junk.map((item) => item.rel).sort();
  assert.deepEqual(rels, ['.DS_Store', 'sub/__pycache__', 'sub/notes.md.bak', 'sub/空']);
  assert.equal(junk.some((item) => item.rel.includes('keep.md')), false, 'real content is never a candidate');
});

await checkAsync('applyCleanup removes the candidates and nothing else', async () => {
  const root = join(WORK_DIR, '垃圾测试');
  const scan = tidy.scanWorkspace(root, { home: HOME_DIR });
  const { removed, skipped, freed_bytes } = tidy.applyCleanup(scan, { dryRun: false });
  assert.ok(removed.length >= 3);
  assert.ok(freed_bytes > 0);
  assert.equal(existsSync(join(root, '.DS_Store')), false);
  assert.equal(existsSync(join(root, 'sub', '__pycache__')), false);
  assert.equal(existsSync(join(root, 'sub', 'keep.md')), true);
  assert.deepEqual(
    skipped.map((item) => item.rel),
    ['sub/空'],
    'an empty folder is reported, never deleted by default',
  );
  assert.equal(existsSync(join(root, 'sub', '空')), true);
});

check('applyCleanup only removes an empty folder when explicitly asked', () => {
  const root = join(WORK_DIR, '垃圾测试');
  const forced = tidy.applyCleanup(tidy.scanWorkspace(root, { home: HOME_DIR }), {
    dryRun: false,
    emptyDirs: true,
  });
  assert.deepEqual(
    forced.removed.map((item) => item.rel),
    ['sub/空'],
  );
  assert.equal(existsSync(join(root, 'sub', '空')), false);
  assert.equal(existsSync(join(root, 'sub', 'keep.md')), true);
});

check('renderIndex lists tasks with their status and stays regenerable', () => {
  const root = join(WORK_DIR, '整理测试');
  const scan = tidy.scanWorkspace(root, { home: HOME_DIR });
  const markdown = tidy.renderIndex(scan, { removed: [{ bytes: 2048 }] });
  assert.ok(markdown.startsWith('# 工作区索引'));
  assert.ok(markdown.includes('| 有任务 |'), 'task row');
  assert.ok(markdown.includes('进行中｜目标：把东西整理好'));
  assert.ok(markdown.includes('上次清理：删除 1 项，释放 2.0 KB'));
  const file = tidy.writeIndex(root, markdown);
  assert.equal(file, join(root, '工作区索引.md'));
  assert.equal(readFileSync(file, 'utf8'), markdown);
});

check('findStrayTasks only flags a stamped folder holding just its progress file', () => {
  const home = join(WORK_DIR, '假home');
  const stray = join(home, 'profiles', 'desktop', '会话日志回退-20261002');
  mkdirSync(stray, { recursive: true });
  writeFileSync(join(stray, 'PROGRESS.md'), '# 越界任务\n');
  const real = join(home, 'profiles', 'desktop', '真任务-20261002');
  mkdirSync(real, { recursive: true });
  writeFileSync(join(real, 'PROGRESS.md'), '# 真任务\n');
  writeFileSync(join(real, 'data.csv'), 'a,b\n');
  const strays = tidy.findStrayTasks({ home });
  assert.deepEqual(
    strays.map((item) => item.path),
    [stray],
  );
});

await checkAsync('task_tidy reports a dry run, writes the index, then applies', async () => {
  const dry = await callTool(taskTidy, { workspace: WORK_DIR });
  assert.equal(dry.applied, false);
  assert.equal(dry.root, WORK_DIR);
  assert.ok(dry.entry_count >= 2);
  assert.ok(existsSync(dry.index_file));
  assert.ok(readFileSync(dry.index_file, 'utf8').includes('# 工作区索引'));
  const applied = await callTool(taskTidy, { workspace: WORK_DIR, apply: true });
  assert.equal(applied.applied, true);
  for (const rel of applied.removed) {
    assert.equal(existsSync(join(WORK_DIR, rel)), false, `${rel} should be gone`);
  }
});

check('dispose unregisters everything', () => {
  dispose();
  assert.equal(state.tools.size, 0);
  assert.equal(state.sections.length, 0);
});

// ------------------------------------------------------------------- CLI parity
process.stdout.write('\ncli\n');
const cli = await import('../src/cli.mjs');
await checkAsync('cli parses flags with and without values', async () => {
  const parsed = cli.parseArgs(['new', '名字', '目标', '--git', '--slug', 's-1', '--root=/x']);
  assert.deepEqual(parsed.positionals, ['new', '名字', '目标']);
  assert.equal(parsed.flags.git, true);
  assert.equal(parsed.flags.slug, 's-1');
  assert.equal(parsed.flags.root, '/x');
});
await checkAsync('cli selectTask finds a task by folder substring', async () => {
  assert.equal(cli.selectTask(WORK_DIR, '端到端'), created.dir);
});

// ------------------------------------------------- root guards & session cwd
process.stdout.write('\nroot guards\n');
check('explicit root inside DSH_HOME is refused', () => {
  assert.throws(
    () => store.resolveWorkspaceRoot(join(HOME_DIR, 'profiles', 'desktop'), '', WORK_DIR),
    /refusing to use/,
  );
});
check('a process.cwd under DSH_HOME is refused instead of silently used', () => {
  const saved = process.env.DSH_TASK_WORKSPACE_ROOT;
  delete process.env.DSH_TASK_WORKSPACE_ROOT;
  try {
    assert.throws(
      () => store.resolveWorkspaceRoot(undefined, '', join(HOME_DIR, 'profiles', 'desktop')),
      /refusing to use/,
    );
  } finally {
    process.env.DSH_TASK_WORKSPACE_ROOT = saved;
  }
});
await checkAsync('task_new falls back to the cwd recorded in the session log', async () => {
  const saved = process.env.DSH_TASK_WORKSPACE_ROOT;
  delete process.env.DSH_TASK_WORKSPACE_ROOT;
  const sessionId = 'session-log-cwd';
  const folder = join(HOME_DIR, 'sessions', '--fake--', sessionId);
  mkdirSync(folder, { recursive: true });
  const header = JSON.stringify({ type: 'session', version: 4, id: sessionId, cwd: WORK_DIR });
  writeFileSync(
    join(folder, 'session.v4.jsonl.zstd'),
    zlibDefault.zstdCompressSync(Buffer.from(`${header}\n`)),
  );
  try {
    const { ctx: c, state: s } = stubCtx({ withSkills: false });
    const dispose2 = plugin.default(c, {});
    try {
      const tool = s.tools.get('task_new');
      const result = await tool.execute(
        { name: '会话日志回退' },
        { callId: 't', name: 'task_new', arguments: {}, signal: new AbortController().signal, agent: { id: sessionId } },
      );
      assert.equal(result.dir, join(WORK_DIR, `${result.folder}`));
      assert.ok(existsSync(join(result.dir, 'PROGRESS.md')));
    } finally {
      dispose2();
    }
  } finally {
    process.env.DSH_TASK_WORKSPACE_ROOT = saved;
  }
});

// --------------------------------------------------------------------- summary
process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const { label, error } of failures) {
    process.stdout.write(`\n--- ${label}\n${error instanceof Error ? error.stack : String(error)}\n`);
  }
}
if (!keep) {
  rmSync(WORK_DIR, { recursive: true, force: true });
  rmSync(HOME_DIR, { recursive: true, force: true });
} else {
  process.stdout.write(`\nkept: ${WORK_DIR}\nkept: ${HOME_DIR}\n`);
}
process.exitCode = failures.length === 0 ? 0 : 1;

// Keep the linter honest about the import used below.
void writeFileSync;
void plugin.conventionText;
