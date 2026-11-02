// 管理命令行：直接改服务端的 SQLite 库（DB_FILE，默认 data/pixel-neu.db）。服务端运行时也能用。
//   node tools/admin.ts reports              待处理的举报
//   node tools/admin.ts find <昵称>           按昵称找账号
//   node tools/admin.ts user <编号>           账号详情和最近的发言
//   node tools/admin.ts mute <编号> <分钟>    禁言（0 解除）
//   node tools/admin.ts ban <编号> / unban <编号>
//   node tools/admin.ts del <消息编号>        删消息，同时关闭对它的举报
//   node tools/admin.ts dismiss <消息编号>    驳回举报
//   node tools/admin.ts logout <编号>         吊销这个账号的所有登录
import { Db } from '../server/db.ts';

const file = process.env.DB_FILE ?? new URL('../data/pixel-neu.db', import.meta.url).pathname;
// 管理操作不碰手机号，盐随便给
const db = new Db(file, process.env.PHONE_SALT ?? 'admin');
const [cmd, a, b] = process.argv.slice(2);
const time = (t: number) => new Date(t).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
const id = (v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error('编号不对');
  return n;
};

switch (cmd) {
  case 'reports':
    for (const r of db.reports()) console.log(`#${r.message}  ${r.count} 人举报  [${r.user}] ${r.name}：${r.text}  (${time(r.t)})`);
    break;
  case 'find':
    for (const u of db.findUsers(a ?? '')) console.log(`[${u.id}] ${u.name}  注册于 ${time(u.created)}${u.banned ? '  已封' : ''}`);
    break;
  case 'user': {
    const u = db.user(id(a));
    if (!u) throw new Error('没有这个账号');
    console.log(u);
    const rows = db.sql.prepare('SELECT id, channel, text, t, deleted FROM messages WHERE user = ? ORDER BY id DESC LIMIT 20').all(u.id) as {
      id: number; channel: string; text: string; t: number; deleted: number;
    }[];
    for (const m of rows) console.log(`#${m.id} ${time(m.t)} [${m.channel}]${m.deleted ? ' (已删)' : ''} ${m.text}`);
    break;
  }
  case 'mute': {
    const min = Number(b ?? 0);
    db.setMuted(id(a), min > 0 ? Date.now() + min * 60_000 : 0);
    console.log(min > 0 ? `已禁言 ${min} 分钟` : '已解除禁言');
    break;
  }
  case 'ban':
    db.setBanned(id(a), true);
    console.log('已封号，登录已吊销');
    break;
  case 'unban':
    db.setBanned(id(a), false);
    console.log('已解封');
    break;
  case 'del':
    db.deleteMessage(id(a));
    db.closeReports(id(a));
    console.log('已删除');
    break;
  case 'dismiss':
    db.closeReports(id(a));
    console.log('已驳回');
    break;
  case 'logout':
    db.dropTokens(id(a));
    console.log('已吊销');
    break;
  default:
    console.log(readUsage());
}

function readUsage(): string {
  return '用法见 tools/admin.ts 开头的注释';
}
