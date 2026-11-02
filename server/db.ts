// 账号、令牌、验证码、聊天记录：都存在一个 SQLite 文件里（Node 自带的 node:sqlite）。
// 路径由 DB_FILE 指定，默认 data/pixel-neu.db（不进仓库）。手机号只存加盐哈希，令牌和验证码只存哈希。
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cleanLook, cleanName, type Look } from '../shared/social.ts';

export interface User {
  id: number;
  name: string;
  look: Look;
  /** 注册时间（毫秒） */
  created: number;
  /** 禁言到什么时候（毫秒），0 表示没禁言 */
  mutedUntil: number;
  banned: boolean;
}

interface UserRow {
  id: number;
  name: string;
  look: string;
  created: number;
  muted_until: number;
  banned: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  phone_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  look TEXT NOT NULL,
  created INTEGER NOT NULL,
  muted_until INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  user INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user);
CREATE TABLE IF NOT EXISTS codes (
  phone_hash TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  expires INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sms_log (
  phone_hash TEXT NOT NULL,
  ip TEXT NOT NULL,
  t INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sms_log_t ON sms_log(t);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  user INTEGER NOT NULL,
  channel TEXT NOT NULL,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  t INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel, id);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  message INTEGER NOT NULL,
  reporter INTEGER NOT NULL,
  t INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  UNIQUE (message, reporter)
);
CREATE TABLE IF NOT EXISTS blocks (
  user INTEGER NOT NULL,
  target INTEGER NOT NULL,
  PRIMARY KEY (user, target)
);
`;

const DAY = 86_400_000;
/** 令牌有效期 */
export const TOKEN_TTL = 30 * DAY;
/** 聊天记录保留多久 */
export const MESSAGE_TTL = 183 * DAY;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export class Db {
  readonly sql: DatabaseSync;
  private readonly salt: string;
  /** 没配 PHONE_SALT：只能当访客，短信登录关闭（盐必须固定，否则同一个号码每次重启都成了新账号） */
  saltless = false;

  /** file 为 ':memory:' 时用内存库（测试） */
  constructor(file: string, salt: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.sql = new DatabaseSync(file);
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.sql.exec(SCHEMA);
    this.salt = salt;
  }

  phoneHash(phone: string): string {
    return createHmac('sha256', this.salt).update(phone).digest('hex');
  }

  // ---------- 验证码 ----------

  /** 最近 ms 毫秒内给这个号码 / 这个 IP 发过几次 */
  smsCount(by: 'phone' | 'ip', key: string, ms: number, now = Date.now()): number {
    const col = by === 'phone' ? 'phone_hash' : 'ip';
    const r = this.sql.prepare(`SELECT COUNT(*) AS n FROM sms_log WHERE ${col} = ? AND t > ?`).get(key, now - ms) as { n: number };
    return r.n;
  }

  saveCode(phoneHash: string, ip: string, code: string, ttl: number, now = Date.now()): void {
    this.sql.prepare('INSERT INTO sms_log (phone_hash, ip, t) VALUES (?, ?, ?)').run(phoneHash, ip, now);
    this.sql
      .prepare('INSERT OR REPLACE INTO codes (phone_hash, hash, expires, tries) VALUES (?, ?, ?, 0)')
      .run(phoneHash, sha(phoneHash + code), now + ttl);
  }

  /** 核对验证码：对了就作废这条验证码；错了记一次，满 maxTries 次也作废 */
  checkCode(phoneHash: string, code: string, maxTries: number, now = Date.now()): 'ok' | 'wrong' | 'expired' {
    const r = this.sql.prepare('SELECT hash, expires, tries FROM codes WHERE phone_hash = ?').get(phoneHash) as
      | { hash: string; expires: number; tries: number }
      | undefined;
    if (!r || r.expires < now || r.tries >= maxTries) return 'expired';
    if (r.hash === sha(phoneHash + code)) {
      this.sql.prepare('DELETE FROM codes WHERE phone_hash = ?').run(phoneHash);
      return 'ok';
    }
    this.sql.prepare('UPDATE codes SET tries = tries + 1 WHERE phone_hash = ?').run(phoneHash);
    return 'wrong';
  }

  // ---------- 账号 ----------

  private toUser(r: UserRow): User {
    let look: Look;
    try {
      look = cleanLook(JSON.parse(r.look));
    } catch {
      look = cleanLook(undefined);
    }
    return { id: r.id, name: r.name, look, created: r.created, mutedUntil: r.muted_until, banned: r.banned === 1 };
  }

  /** 按手机号哈希找账号，没有就注册一个 */
  userByPhone(phoneHash: string, now = Date.now()): { user: User; created: boolean } {
    const r = this.sql.prepare('SELECT * FROM users WHERE phone_hash = ?').get(phoneHash) as UserRow | undefined;
    if (r) return { user: this.toUser(r), created: false };
    const id = this.sql
      .prepare('INSERT INTO users (phone_hash, name, look, created) VALUES (?, ?, ?, ?)')
      .run(phoneHash, cleanName(''), JSON.stringify(cleanLook(undefined)), now).lastInsertRowid;
    return { user: this.user(Number(id))!, created: true };
  }

  user(id: number): User | undefined {
    const r = this.sql.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return r && this.toUser(r);
  }

  setProfile(id: number, name: unknown, look: unknown): User | undefined {
    this.sql
      .prepare('UPDATE users SET name = ?, look = ? WHERE id = ?')
      .run(cleanName(name), JSON.stringify(cleanLook(look as Partial<Look>)), id);
    return this.user(id);
  }

  setMuted(id: number, until: number): void {
    this.sql.prepare('UPDATE users SET muted_until = ? WHERE id = ?').run(until, id);
  }

  setBanned(id: number, banned: boolean): void {
    this.sql.prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned ? 1 : 0, id);
    if (banned) this.sql.prepare('DELETE FROM tokens WHERE user = ?').run(id);
  }

  findUsers(name: string): User[] {
    return (this.sql.prepare('SELECT * FROM users WHERE name LIKE ? ORDER BY id LIMIT 50').all(`%${name}%`) as unknown as UserRow[]).map((r) =>
      this.toUser(r),
    );
  }

  // ---------- 令牌 ----------

  saveToken(token: string, user: number, now = Date.now()): void {
    this.sql.prepare('INSERT INTO tokens (hash, user, expires) VALUES (?, ?, ?)').run(sha(token), user, now + TOKEN_TTL);
  }

  /** 令牌对应的账号；过期、封号都返回 undefined */
  userByToken(token: unknown, now = Date.now()): User | undefined {
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) return undefined;
    const r = this.sql.prepare('SELECT user, expires FROM tokens WHERE hash = ?').get(sha(token)) as
      | { user: number; expires: number }
      | undefined;
    if (!r || r.expires < now) return undefined;
    const u = this.user(r.user);
    return u && !u.banned ? u : undefined;
  }

  dropToken(token: string): void {
    this.sql.prepare('DELETE FROM tokens WHERE hash = ?').run(sha(token));
  }

  /** 吊销某人的所有令牌（换设备、令牌泄露） */
  dropTokens(user: number): void {
    this.sql.prepare('DELETE FROM tokens WHERE user = ?').run(user);
  }

  // ---------- 聊天 ----------

  addMessage(user: number, channel: string, name: string, text: string, now = Date.now()): number {
    return Number(
      this.sql.prepare('INSERT INTO messages (user, channel, name, text, t) VALUES (?, ?, ?, ?, ?)').run(user, channel, name, text, now)
        .lastInsertRowid,
    );
  }

  /** 某频道最近 n 条（旧的在前） */
  history(channel: string, n: number): { id: number; user: number; name: string; text: string; t: number }[] {
    const rows = this.sql
      .prepare('SELECT id, user, name, text, t FROM messages WHERE channel = ? AND deleted = 0 ORDER BY id DESC LIMIT ?')
      .all(channel, n) as unknown as { id: number; user: number; name: string; text: string; t: number }[];
    return rows.reverse();
  }

  message(id: number): { id: number; user: number; channel: string; name: string; text: string; t: number; deleted: number } | undefined {
    return this.sql.prepare('SELECT * FROM messages WHERE id = ?').get(id) as never;
  }

  deleteMessage(id: number): void {
    this.sql.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(id);
  }

  report(message: number, reporter: number, now = Date.now()): void {
    this.sql.prepare('INSERT OR IGNORE INTO reports (message, reporter, t) VALUES (?, ?, ?)').run(message, reporter, now);
  }

  /** 待处理的举报，按消息合并 */
  reports(): { message: number; count: number; user: number; name: string; text: string; t: number }[] {
    return this.sql
      .prepare(
        `SELECT r.message, COUNT(*) AS count, m.user, m.name, m.text, m.t FROM reports r JOIN messages m ON m.id = r.message
         WHERE r.done = 0 GROUP BY r.message ORDER BY count DESC, r.message`,
      )
      .all() as never;
  }

  closeReports(message: number): void {
    this.sql.prepare('UPDATE reports SET done = 1 WHERE message = ?').run(message);
  }

  block(user: number, target: number): void {
    if (user !== target) this.sql.prepare('INSERT OR IGNORE INTO blocks (user, target) VALUES (?, ?)').run(user, target);
  }

  unblock(user: number, target: number): void {
    this.sql.prepare('DELETE FROM blocks WHERE user = ? AND target = ?').run(user, target);
  }

  /** 和 user 互相屏蔽的人：他拉黑的，加上拉黑他的 */
  blocked(user: number): Set<number> {
    const rows = this.sql.prepare('SELECT target AS u FROM blocks WHERE user = ? UNION SELECT user AS u FROM blocks WHERE target = ?').all(user, user) as {
      u: number;
    }[];
    return new Set(rows.map((r) => r.u));
  }

  /** 他自己拉黑的人（给客户端显示「已拉黑」列表） */
  blockList(user: number): number[] {
    return (this.sql.prepare('SELECT target FROM blocks WHERE user = ?').all(user) as { target: number }[]).map((r) => r.target);
  }

  /** 清理过期数据：令牌、验证码、发送记录、半年前的聊天 */
  sweep(now = Date.now()): void {
    this.sql.prepare('DELETE FROM tokens WHERE expires < ?').run(now);
    this.sql.prepare('DELETE FROM codes WHERE expires < ?').run(now);
    this.sql.prepare('DELETE FROM sms_log WHERE t < ?').run(now - DAY);
    this.sql.prepare('DELETE FROM messages WHERE t < ?').run(now - MESSAGE_TTL);
  }
}

let shared: Db | undefined;

/** 服务端进程共用的库：DB_FILE、PHONE_SALT 读环境变量；开发模式没配盐时用固定的开发盐 */
export function openDb(): Db {
  if (shared) return shared;
  const dev = process.argv.includes('--dev');
  const salt = process.env.PHONE_SALT ?? (dev ? 'pixel-neu-dev-salt' : '');
  if (!salt) console.error('没有配置 PHONE_SALT（手机号哈希的盐），短信登录关闭，所有人都是访客。见 docs/deploy.md');
  const file = process.env.DB_FILE ?? new URL('../data/pixel-neu.db', import.meta.url).pathname;
  shared = new Db(file, salt || randomBytes(32).toString('hex'));
  shared.saltless = !salt;
  shared.sweep();
  setInterval(() => shared!.sweep(), 3_600_000).unref();
  return shared;
}
