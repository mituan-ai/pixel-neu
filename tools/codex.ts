// 把任务单交给 Codex：每张任务单一个 git worktree（分支 codex/<任务>），后台跑 codex exec，做完由维护者检查、合并。
//   node tools/codex.ts start TASK-14     建 worktree 并开跑（任务单 docs/codex/TASK-14-*.md 要先提交到当前分支）
//   node tools/codex.ts status            各任务的状态和 Codex 的最后回复
//   node tools/codex.ts check TASK-14     在 worktree 里跑 typecheck 和测试，列出改动
//   node tools/codex.ts merge TASK-14     提交 Codex 留下的改动（生成产物除外），合并进当前分支，删掉 worktree 和分支（合并后自己跑 npm run map && npm run art）
//   node tools/codex.ts drop TASK-14      不要了：删掉 worktree 和分支
// worktree 在仓库旁边的 pixel-neu-codex/<任务>/，日志 <任务>.log，Codex 的最后回复 <任务>.md。
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOME = join(dirname(ROOT), `${basename(ROOT)}-codex`);
/** 不进仓库、但描图要用的本地资料：链接进 worktree（只读用） */
const LOCAL = ['node_modules', 'data/sat-2025-07-31.png', 'data/sat-2026-10-29.png', 'data/sat-tianditu.png', 'data/ref', '.env.local'];

const [cmd, task] = process.argv.slice(2);
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const sh = (cwd: string, line: string) => {
  try {
    return { ok: true, out: execFileSync('bash', ['-c', line], { cwd, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};
const dir = (t: string) => join(HOME, t);
const alive = (t: string) => {
  const f = join(HOME, `${t}.pid`);
  if (!existsSync(f)) return false;
  try {
    process.kill(Number(readFileSync(f, 'utf8')), 0);
    return true;
  } catch {
    return false;
  }
};
function need(t: string | undefined): string {
  if (!t || !/^TASK-\d+$/.test(t)) throw new Error('要写任务编号，例如 TASK-14');
  return t;
}
function sheet(t: string): string {
  const f = readdirSync(join(ROOT, 'docs/codex')).find((n) => n.startsWith(`${t}-`) && n.endsWith('.md'));
  if (!f) throw new Error(`docs/codex/ 里没有 ${t}-*.md`);
  return `docs/codex/${f}`;
}
/** PROMPT.md 里「提示词」一节，换上任务单路径 */
function prompt(path: string): string {
  const md = readFileSync(join(ROOT, 'docs/codex/PROMPT.md'), 'utf8');
  const body = md.split('## 提示词')[1].split('\n---')[0];
  return body.replaceAll('<任务单路径>', path).trim();
}

if (cmd === 'start') {
  const t = need(task), path = sheet(t), wt = dir(t);
  if (git(ROOT, 'status', '--porcelain', '--', path)) throw new Error(`${path} 还没提交，worktree 里看不到它`);
  if (existsSync(wt)) throw new Error(`${wt} 已经有了：先 drop 或 merge`);
  mkdirSync(HOME, { recursive: true });
  git(ROOT, 'worktree', 'add', '-b', `codex/${t}`, wt);
  // art/ 子模块从本机的副本克隆，不走网络
  git(wt, 'config', 'submodule.art.url', join(ROOT, 'art'));
  execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'update', '--init'], { cwd: wt, stdio: 'ignore' });
  for (const f of LOCAL) if (existsSync(join(ROOT, f)) && !existsSync(join(wt, f))) symlinkSync(join(ROOT, f), join(wt, f));
  // .gitignore 里的 node_modules/、data/ref/ 只匹配目录，链接要另外排除
  const exclude = join(ROOT, git(ROOT, 'rev-parse', '--git-common-dir'), 'info/exclude');
  const have = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  const add = LOCAL.filter((f) => !have.split('\n').includes(`/${f}`)).map((f) => `/${f}\n`).join('');
  if (add) writeFileSync(exclude, have + (have && !have.endsWith('\n') ? '\n' : '') + add);
  const log = openSync(join(HOME, `${t}.log`), 'w');
  // 沙箱默认只能写 worktree：测试要写 node_modules 里的缓存，参考照片放主仓库的 data/ref。.git 沙箱总是只读，所以由 merge 替 Codex 提交
  mkdirSync(join(ROOT, 'data/ref'), { recursive: true });
  const writable = [join(ROOT, 'node_modules'), join(ROOT, 'data/ref')].flatMap((d) => ['--add-dir', d]);
  // 模型和思考强度固定：gpt-6.1-sol、中等，性价比最高
  const child = spawn('codex', ['exec', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="medium"', '-C', wt, '-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', ...writable, '-o', join(HOME, `${t}.md`), prompt(path)], {
    detached: true,
    stdio: ['ignore', log, log],
  });
  writeFileSync(join(HOME, `${t}.pid`), String(child.pid));
  child.unref();
  console.log(`${t} 已开跑：${wt}\n日志 ${join(HOME, `${t}.log`)}`);
} else if (cmd === 'status') {
  if (!existsSync(HOME)) process.exit(0);
  for (const t of readdirSync(HOME).filter((n) => /^TASK-\d+$/.test(n)).sort()) {
    const wt = dir(t), commits = git(wt, 'log', '--oneline', `HEAD...${git(ROOT, 'rev-parse', 'HEAD')}`, '--left-only').split('\n').filter(Boolean).length;
    const reply = join(HOME, `${t}.md`);
    console.log(`\n## ${t}：${alive(t) ? '运行中' : '已结束'}，${commits} 个提交，${git(wt, 'status', '--porcelain').split('\n').filter(Boolean).length} 个未提交改动`);
    if (!alive(t) && existsSync(reply)) console.log(readFileSync(reply, 'utf8').trim());
  }
} else if (cmd === 'check') {
  const t = need(task), wt = dir(t);
  if (alive(t)) throw new Error(`${t} 还在跑`);
  console.log(git(wt, 'diff', '--stat', `${git(ROOT, 'rev-parse', 'HEAD')}...HEAD`));
  console.log(git(wt, 'status', '--short') || '（没有未提交的改动）');
  for (const line of ['npm run typecheck', 'npm test', 'node tools/looks.ts']) {
    const r = sh(wt, line);
    console.log(`${r.ok ? '通过' : '失败'}：${line}`);
    if (!r.ok) console.log(r.out.split('\n').slice(-30).join('\n'));
  }
} else if (cmd === 'merge' || cmd === 'drop') {
  const t = need(task), wt = dir(t);
  if (alive(t)) throw new Error(`${t} 还在跑`);
  if (cmd === 'merge') {
    // 生成产物不进提交；剩下的改动以任务单标题提交
    git(wt, 'checkout', '--', 'assets');
    git(wt, 'clean', '-fdq', '--', 'assets');
    git(join(wt, 'art'), 'checkout', '--', '.');
    if (git(wt, 'status', '--porcelain')) {
      git(wt, 'add', '-A');
      git(wt, 'commit', '-m', readFileSync(join(ROOT, sheet(t)), 'utf8').split('\n')[0].replace(/^#\s*/, ''));
    }
    try {
      git(ROOT, 'merge', '--no-ff', '-m', `合并 Codex ${t}`, `codex/${t}`);
    } catch {
      // 几张分片任务单常改同一个文件的不同行（survey.json、楼档案表）：行数没变时逐行三方合并，两边改了同一行才算真冲突
      const files = git(ROOT, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
      for (const f of files) {
        const [base, ours, theirs] = [1, 2, 3].map((k) => git(ROOT, 'show', `:${k}:${f}`).split('\n'));
        if (base.length !== ours.length || base.length !== theirs.length || base.some((b, i) => ours[i] !== b && theirs[i] !== b && ours[i] !== theirs[i]))
          throw new Error(`${f} 有真冲突，手动解决后 git commit，再 node tools/codex.ts drop ${t}`);
        writeFileSync(join(ROOT, f), base.map((b, i) => (theirs[i] !== b ? theirs[i] : ours[i])).join('\n') + '\n');
        if (f.endsWith('.json')) JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
        git(ROOT, 'add', f);
      }
      git(ROOT, 'commit', '--no-edit');
    }
  }
  git(ROOT, 'worktree', 'remove', '--force', wt);
  git(ROOT, 'branch', '-D', `codex/${t}`);
  console.log(`${t} 已${cmd === 'merge' ? '合并' : '删除'}`);
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 8).join('\n'));
}
