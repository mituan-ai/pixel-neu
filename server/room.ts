// 一个“平行校园”房间：同步所有人的位置与外观，转发表情、短语和文字聊天，广播天气。
// 位置由客户端上报，服务端只做合理性校验（速度、碰撞），不合理就把客户端拉回上一个合法位置。
// 登录的人进 players（别人看得见）；访客只收状态，不进 players，不能发言，也不占 ROOM_MAX。
import { readFileSync } from 'node:fs';
import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { CHAT, CHAT_COOLDOWN, EMOTES, EVENT, GUEST_MAX, MSG, PHRASES, ROOM_FULL, ROOM_MAX } from '../shared/social.ts';
import { CampusState, Player } from '../shared/state.ts';
import { DEV_BOOST, LAYER, RIDE_FACTOR, RIDE_REACH, WALK_SPEED, Walkable, isRideable, prop, type TiledMap } from '../shared/world.ts';
import { chatHub, type Peer } from './chat.ts';
import { openDb, type User } from './db.ts';
import { weather } from './weather.ts';

/** 地图：线上由 MAP_FILE 指定（打包后相对路径不可靠），开发时读仓库里的 assets/map.json */
const map: TiledMap = JSON.parse(readFileSync(process.env.MAP_FILE ?? new URL('../assets/map.json', import.meta.url), 'utf8'));
const walk = new Walkable(map);
const spawn = (() => {
  const layer = map.layers.find((l) => l.name === LAYER.objects);
  const o = layer?.type === 'objectgroup' ? layer.objects.find((o) => o.type === 'spawn') : undefined;
  if (!o) throw new Error('地图里没有出生点');
  return { x: o.x, y: o.y, r: prop(o, 'radius', 32) };
})();

/** 能骑的单车：地图物件编号 → 位置 */
const bikes = (() => {
  const layer = map.layers.find((l) => l.name === LAYER.objects);
  const out = new Map<number, { x: number; y: number }>();
  if (layer?.type === 'objectgroup') for (const o of layer.objects) if (o.type === 'prop' && isRideable(prop(o, 'sprite', ''))) out.set(o.id, { x: o.x, y: o.y });
  return out;
})();

/** 允许的速度余量：网络抖动时两次上报间隔不均匀 */
const SPEED_SLACK = 1.6;
/** 本地开发（npm run server 带 --dev）放行开发者模式的 Shift 加速 */
const MAX_SPEED = WALK_SPEED * (process.argv.includes('--dev') ? DEV_BOOST : 1);

const db = openDb();
const hub = chatHub(db);

interface Seen {
  x: number;
  y: number;
  t: number;
  chat: number;
  user?: User;
  /** 在 players 里（别人看得见） */
  visible: boolean;
  /** 最近一次下车的时刻：下车后一秒内仍按骑车速度校验 */
  dismount: number;
}

interface JoinOptions {
  token?: unknown;
}

export class CampusRoom extends Room<{ state: CampusState }> {
  maxClients = ROOM_MAX + GUEST_MAX;
  maxMessagesPerSecond = 30;
  state = new CampusState();
  private seen = new Map<string, Seen>();
  /** 通过了鉴权、还没进房的人：同时涌进来很多人时，名额要把他们算上 */
  private pending: { guest: boolean; t: number }[] = [];
  private unsubscribe?: () => void;

  messages = {
    [MSG.move]: (client: Client, m: { x?: unknown; y?: unknown; dir?: unknown; moving?: unknown }) => {
      const s = this.seen.get(client.sessionId);
      if (!s) return;
      const x = Number(m.x), y = Number(m.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const p = this.state.players.get(client.sessionId);
      // 访客的位置只用来投递附近频道的消息，不校验
      if (!p) {
        s.x = x;
        s.y = y;
        return;
      }
      const now = Date.now();
      const fast = p.ride || now - s.dismount < 1000 ? RIDE_FACTOR : 1;
      const maxStep = (MAX_SPEED * fast * SPEED_SLACK * Math.max(50, now - s.t)) / 1000 + 4;
      if (Math.hypot(x - s.x, y - s.y) > maxStep || walk.footBlocked(x, y) || !walk.reachable(s, { x, y })) {
        client.send(EVENT.snap, { x: s.x, y: s.y });
        return;
      }
      s.x = p.x = x;
      s.y = p.y = y;
      s.t = now;
      p.dir = Number.isInteger(m.dir) && (m.dir as number) >= 0 && (m.dir as number) < 4 ? (m.dir as number) : p.dir;
      p.moving = m.moving === true;
    },
    // 骑车：走到单车 3 m 内才能骑上，一辆车同时只能一个人骑；0 是下车，单车回到原位
    [MSG.ride]: (client: Client, id: unknown) => {
      const p = this.state.players.get(client.sessionId);
      const s = this.seen.get(client.sessionId);
      if (!p || !s || !Number.isInteger(id)) return;
      if (id === 0) {
        if (p.ride) s.dismount = Date.now();
        p.ride = 0;
        return;
      }
      const b = bikes.get(id as number);
      if (!b || Math.hypot(b.x - p.x, b.y - p.y) > RIDE_REACH) return;
      for (const q of this.state.players.values()) if (q.ride === id) return;
      p.ride = id as number;
    },
    [MSG.emote]: (client: Client, id: unknown) => {
      if (this.chatAllowed(client) && Number.isInteger(id) && (id as number) >= 0 && (id as number) < EMOTES.length)
        this.broadcast(EVENT.emote, { id: client.sessionId, emote: id });
    },
    [MSG.say]: (client: Client, id: unknown) => {
      if (this.chatAllowed(client) && Number.isInteger(id) && (id as number) >= 0 && (id as number) < PHRASES.length)
        this.broadcast(EVENT.say, { id: client.sessionId, phrase: id });
    },
    [MSG.chat]: (client: Client, m: { ch?: unknown; text?: unknown }) => {
      const s = this.seen.get(client.sessionId);
      if (!s) return;
      const r = hub.post(s.user, client.sessionId, m?.ch, m?.text);
      if (typeof r === 'string') {
        if (r) client.send(EVENT.notice, { text: r });
        return;
      }
      if (r.ch !== 'near') return;
      const near: Peer[] = [];
      for (const c of this.clients) {
        const o = this.seen.get(c.sessionId), peer = hub.peers.get(c.sessionId);
        if (o && peer && Math.hypot(o.x - s.x, o.y - s.y) <= CHAT.nearRange) near.push(peer);
      }
      hub.deliver(r, near);
    },
    [MSG.history]: (client: Client, ch: unknown) => {
      const peer = hub.peers.get(client.sessionId);
      const h = peer && hub.history(peer, ch);
      if (h) client.send(EVENT.history, h);
    },
    [MSG.report]: (client: Client, msg: unknown) => {
      if (hub.report(this.seen.get(client.sessionId)?.user, msg)) client.send(EVENT.notice, { text: '已举报，谢谢。管理员会尽快处理' });
    },
    [MSG.block]: (client: Client, uid: unknown) => {
      if (hub.block(this.seen.get(client.sessionId)?.user, uid, true)) client.send(EVENT.notice, { text: '已拉黑，你们互相看不到对方的消息' });
    },
    [MSG.unblock]: (client: Client, uid: unknown) => {
      if (hub.block(this.seen.get(client.sessionId)?.user, uid, false)) client.send(EVENT.notice, { text: '已取消拉黑' });
    },
    /** 资料在 /api/profile 改完后，通知房间按库里的新资料更新外观 */
    [MSG.profile]: (client: Client) => {
      const s = this.seen.get(client.sessionId);
      const u = s?.user && db.user(s.user.id);
      const p = this.state.players.get(client.sessionId);
      if (!s || !u) return;
      s.user = u;
      if (p) Object.assign(p, { name: u.name, ...u.look });
    },
  };

  onCreate() {
    this.unsubscribe = weather.subscribe((w) => this.broadcast(EVENT.weather, w));
  }

  onDispose() {
    this.unsubscribe?.();
  }

  onAuth(_client: Client, options: JoinOptions = {}, _context: AuthContext): { user?: User } {
    const user = db.userByToken(options.token);
    const now = Date.now();
    this.pending = this.pending.filter((p) => now - p.t < 10_000);
    const { players, guests } = this.counts();
    // 满了就拒绝，客户端稍等重试时房间已经锁上，会被分进新的平行房间
    if (user ? players >= ROOM_MAX : guests >= GUEST_MAX) throw new ServerError(ROOM_FULL, user ? '这个平行校园满了' : '旁观人数已满');
    this.pending.push({ guest: !user, t: now });
    this.relock();
    return { user };
  }

  /** 人数：已经进房的加上正在进门的 */
  private counts(): { players: number; guests: number } {
    const pg = this.pending.filter((p) => p.guest).length;
    return { players: this.state.players.size + this.pending.length - pg, guests: this.clients.length - this.state.players.size + pg };
  }

  onJoin(client: Client, _options: JoinOptions = {}, auth: { user?: User } = {}) {
    const user = auth.user;
    // 出生点附近随机散开，避免大家叠在同一格
    let x = spawn.x, y = spawn.y;
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * spawn.r;
      const cx = spawn.x + Math.cos(a) * d, cy = spawn.y + Math.sin(a) * d;
      if (!walk.footBlocked(cx, cy)) {
        x = cx;
        y = cy;
        break;
      }
    }
    const k = this.pending.findIndex((p) => p.guest === !user);
    if (k >= 0) this.pending.splice(k, 1);
    const visible = !!user && this.state.players.size < ROOM_MAX;
    if (visible) this.state.players.set(client.sessionId, new Player({ name: user.name, ...user.look, x, y, dir: 3, moving: false, uid: user.id, ride: 0 }));
    this.seen.set(client.sessionId, { x, y, t: Date.now(), chat: 0, user, visible, dismount: 0 });
    hub.peers.set(client.sessionId, {
      sid: client.sessionId,
      uid: user?.id ?? 0,
      blocked: user ? db.blocked(user.id) : new Set(),
      send: (type, msg) => client.send(type, msg),
    });
    client.send(EVENT.hello, { x, y, visible, weather: weather.get() });
    this.relock();
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.seen.delete(client.sessionId);
    hub.peers.delete(client.sessionId);
    this.relock();
  }

  /** 登录的人满 40 或访客满 60 就锁房间，让新来的人进新的平行房间 */
  private relock(): void {
    const { players, guests } = this.counts();
    const full = players >= ROOM_MAX || guests >= GUEST_MAX || this.clients.length + this.pending.length >= this.maxClients;
    if (full && !this.locked) void this.lock();
    else if (!full && this.locked) void this.unlock();
  }

  private chatAllowed(client: Client): boolean {
    const s = this.seen.get(client.sessionId);
    if (!s?.visible) return false;
    const now = Date.now();
    if (now - s.chat < CHAT_COOLDOWN) return false;
    s.chat = now;
    return true;
  }
}
