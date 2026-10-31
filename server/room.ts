// 一个“平行校园”房间：同步所有人的位置与外观，转发表情和短语。
// 位置由客户端上报，服务端只做合理性校验（速度、碰撞），不合理就把客户端拉回上一个合法位置。
import { readFileSync } from 'node:fs';
import { Room, type Client } from '@colyseus/core';
import { CHAT_COOLDOWN, EMOTES, EVENT, MSG, PHRASES, ROOM_MAX, cleanLook, cleanName } from '../shared/social.ts';
import { CampusState, Player } from '../shared/state.ts';
import { LAYER, WALK_SPEED, Walkable, prop, type TiledMap } from '../shared/world.ts';

const map: TiledMap = JSON.parse(readFileSync(new URL('../assets/map.json', import.meta.url), 'utf8'));
const walk = new Walkable(map);
const spawn = (() => {
  const layer = map.layers.find((l) => l.name === LAYER.objects);
  const o = layer?.type === 'objectgroup' ? layer.objects.find((o) => o.type === 'spawn') : undefined;
  if (!o) throw new Error('地图里没有出生点');
  return { x: o.x, y: o.y, r: prop(o, 'radius', 32) };
})();

/** 允许的速度余量：网络抖动时两次上报间隔不均匀 */
const SPEED_SLACK = 1.6;

interface Seen {
  x: number;
  y: number;
  t: number;
  chat: number;
}

export class CampusRoom extends Room<{ state: CampusState }> {
  maxClients = ROOM_MAX;
  maxMessagesPerSecond = 30;
  state = new CampusState();
  private seen = new Map<string, Seen>();

  messages = {
    [MSG.move]: (client: Client, m: { x?: unknown; y?: unknown; dir?: unknown; moving?: unknown }) => {
      const p = this.state.players.get(client.sessionId);
      const s = this.seen.get(client.sessionId);
      if (!p || !s) return;
      const x = Number(m.x), y = Number(m.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const now = Date.now();
      const maxStep = (WALK_SPEED * SPEED_SLACK * Math.max(50, now - s.t)) / 1000 + 4;
      if (Math.hypot(x - s.x, y - s.y) > maxStep || walk.footBlocked(x, y)) {
        client.send(EVENT.snap, { x: s.x, y: s.y });
        return;
      }
      s.x = p.x = x;
      s.y = p.y = y;
      s.t = now;
      p.dir = Number.isInteger(m.dir) && (m.dir as number) >= 0 && (m.dir as number) < 4 ? (m.dir as number) : p.dir;
      p.moving = m.moving === true;
    },
    [MSG.emote]: (client: Client, id: unknown) => {
      if (this.chatAllowed(client) && Number.isInteger(id) && (id as number) >= 0 && (id as number) < EMOTES.length)
        this.broadcast(EVENT.emote, { id: client.sessionId, emote: id });
    },
    [MSG.say]: (client: Client, id: unknown) => {
      if (this.chatAllowed(client) && Number.isInteger(id) && (id as number) >= 0 && (id as number) < PHRASES.length)
        this.broadcast(EVENT.say, { id: client.sessionId, phrase: id });
    },
  };

  onJoin(client: Client, options: { name?: unknown; look?: object } = {}) {
    const look = cleanLook(options.look);
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
    const p = new Player({ name: cleanName(options.name), ...look, x, y, dir: 3, moving: false });
    this.state.players.set(client.sessionId, p);
    this.seen.set(client.sessionId, { x, y, t: Date.now(), chat: 0 });
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.seen.delete(client.sessionId);
  }

  private chatAllowed(client: Client): boolean {
    const s = this.seen.get(client.sessionId);
    if (!s) return false;
    const now = Date.now();
    if (now - s.chat < CHAT_COOLDOWN) return false;
    s.chat = now;
    return true;
  }
}
