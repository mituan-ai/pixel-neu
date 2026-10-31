// 联机：连上 Colyseus 房间，把状态变化和瞬时事件转成回调。场景只和这里打交道，不直接碰 SDK。
import { Callbacks, Client, type Room } from '@colyseus/sdk';
import { EVENT, MSG, ROOM_NAME, type Look } from '../shared/social.ts';
import type { CampusState, Player } from '../shared/state.ts';

export interface NetHandlers {
  add(id: string, p: Player, self: boolean): void;
  change(id: string, p: Player): void;
  remove(id: string): void;
  emote(id: string, emote: number): void;
  say(id: string, phrase: number): void;
  /** 服务端认为位置不合理，拉回到 (x, y) */
  snap(x: number, y: number): void;
  left(code: number): void;
}

/** 位置上报的最短间隔（毫秒） */
const SEND_EVERY = 100;

export class Net {
  readonly room: Room<unknown, CampusState>;
  private last = { x: 0, y: 0, dir: -1, moving: false, t: 0 };

  private constructor(room: Room<unknown, CampusState>, h: NetHandlers) {
    this.room = room;
    const cb = Callbacks.get(room);
    cb.onAdd('players', (p, id) => {
      h.add(id, p, id === room.sessionId);
      cb.onChange(p, () => h.change(id, p));
    });
    cb.onRemove('players', (_p, id) => h.remove(id));
    room.onMessage(EVENT.emote, (m: { id: string; emote: number }) => h.emote(m.id, m.emote));
    room.onMessage(EVENT.say, (m: { id: string; phrase: number }) => h.say(m.id, m.phrase));
    room.onMessage(EVENT.snap, (m: { x: number; y: number }) => h.snap(m.x, m.y));
    room.onLeave((code: number) => h.left(code));
  }

  /** 服务地址：与页面同源的 /colyseus（开发时 Vite 代理，线上 nginx 代理） */
  static endpoint(): string {
    return new URL('colyseus', location.href).href.replace(/\/$/, '');
  }

  static async join(name: string, look: Look, h: NetHandlers): Promise<Net> {
    const client = new Client(Net.endpoint());
    const room = await client.joinOrCreate<CampusState>(ROOM_NAME, { name, look });
    return new Net(room, h);
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  get roomId(): string {
    return this.room.roomId;
  }

  /** 节流上报位置：停下的那一刻立即发一次，保证别人看到的落点准确 */
  move(x: number, y: number, dir: number, moving: boolean): void {
    const now = performance.now();
    const l = this.last;
    const changed = Math.abs(x - l.x) > 0.5 || Math.abs(y - l.y) > 0.5 || dir !== l.dir || moving !== l.moving;
    if (!changed) return;
    if (moving && l.moving && now - l.t < SEND_EVERY) return;
    this.room.send(MSG.move, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, dir, moving });
    Object.assign(l, { x, y, dir, moving, t: now });
  }

  /** 被服务端拉回后，以拉回点为新的上报基准 */
  resetLast(x: number, y: number): void {
    Object.assign(this.last, { x, y });
  }

  emote(i: number): void {
    this.room.send(MSG.emote, i);
  }

  say(i: number): void {
    this.room.send(MSG.say, i);
  }

  leave(): void {
    void this.room.leave();
  }
}
