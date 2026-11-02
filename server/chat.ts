// 文字聊天：校验、限频、敏感词、存库，以及跨房间的广场和讨论室。附近频道的投递由房间自己按距离做。
// 敏感词表在服务端本地（BADWORDS_FILE，默认 data/badwords.txt，每行一个词），不进仓库。
import { existsSync, readFileSync } from 'node:fs';
import { CHAT, cleanText, isChannel, type Channel, type ChatLine } from '../shared/social.ts';
import type { Db, User } from './db.ts';

/** 一个在线连接（玩家或访客） */
export interface Peer {
  sid: string;
  /** 访客为 0 */
  uid: number;
  /** 互相屏蔽的账号 */
  blocked: Set<number>;
  send(type: string, msg: unknown): void;
}

function loadBadwords(): string[] {
  const file = process.env.BADWORDS_FILE ?? new URL('../data/badwords.txt', import.meta.url).pathname;
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w && !w.startsWith('#'));
}

export class ChatHub {
  readonly db: Db;
  private words: string[];
  private last = new Map<number, number>();
  /** 所有房间的在线连接，按 sessionId */
  readonly peers = new Map<string, Peer>();

  constructor(db: Db, words = loadBadwords()) {
    this.db = db;
    this.words = words;
  }

  /** 敏感词换成同样长度的 ＊ */
  filter(text: string): string {
    let out = text;
    const low = text.toLowerCase();
    for (const w of this.words) {
      let i = low.indexOf(w);
      while (i >= 0) {
        out = out.slice(0, i) + '＊'.repeat(w.length) + out.slice(i + w.length);
        i = low.indexOf(w, i + w.length);
      }
    }
    return out;
  }

  /**
   * 校验并存库，返回要投递的消息，或者给发言人看的拒绝理由。
   * 广场和讨论室由这里直接投递给所有房间；附近频道由调用方按距离投递。
   */
  post(user: User | undefined, sid: string, ch: unknown, raw: unknown, now = Date.now()): ChatLine | string {
    if (!user) return '登录后才能发言';
    if (!isChannel(ch)) return '没有这个频道';
    const fresh = this.db.user(user.id) ?? user;
    if (fresh.banned) return '账号已被封禁';
    if (fresh.mutedUntil > now) return `已被禁言，${new Date(fresh.mutedUntil).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 解除`;
    if (ch !== 'near' && now - fresh.created < CHAT.newbie) return '注册满 10 分钟后才能在广场和讨论室发言，先在附近频道打个招呼吧';
    const text = this.filter(cleanText(raw));
    if (!text) return '';
    if (now - (this.last.get(user.id) ?? 0) < CHAT.cooldown) return '说得太快了，歇一下';
    this.last.set(user.id, now);
    const id = this.db.addMessage(user.id, ch, fresh.name, text, now);
    const line: ChatLine = { id, ch, uid: user.id, sid, name: fresh.name, text, t: now };
    if (ch !== 'near') this.deliver({ ...line, sid: '' }, [...this.peers.values()], sid);
    return line;
  }

  /** 投递给一组连接，跳过互相屏蔽的；发言人自己收到带 sid 的版本（知道是自己说的） */
  deliver(line: ChatLine, to: Iterable<Peer>, selfSid = line.sid): void {
    for (const p of to) {
      if (p.blocked.has(line.uid)) continue;
      p.send('chat', p.sid === selfSid ? { ...line, sid: selfSid } : line);
    }
  }

  history(peer: Peer, ch: unknown): { ch: Channel; lines: ChatLine[] } | undefined {
    if (!isChannel(ch) || ch === 'near') return undefined;
    const n = ch === 'square' ? CHAT.squareHistory : CHAT.roomHistory;
    const lines = this.db
      .history(ch, n)
      .filter((m) => !peer.blocked.has(m.user))
      .map((m) => ({ id: m.id, ch, uid: m.user, sid: '', name: m.name, text: m.text, t: m.t }));
    return { ch, lines };
  }

  report(user: User | undefined, msg: unknown): boolean {
    if (!user || !Number.isInteger(msg)) return false;
    const m = this.db.message(msg as number);
    if (!m || m.user === user.id) return false;
    this.db.report(m.id, user.id);
    return true;
  }

  /** 拉黑：双方在线的连接立刻互相屏蔽 */
  block(user: User | undefined, target: unknown, on: boolean): boolean {
    if (!user || !Number.isInteger(target) || target === user.id) return false;
    const t = target as number;
    if (on) this.db.block(user.id, t);
    else this.db.unblock(user.id, t);
    for (const p of this.peers.values()) {
      if (p.uid === user.id || p.uid === t) p.blocked = this.db.blocked(p.uid);
    }
    return true;
  }
}

let shared: ChatHub | undefined;

export function chatHub(db: Db): ChatHub {
  return (shared ??= new ChatHub(db));
}
