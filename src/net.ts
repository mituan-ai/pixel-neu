// 联机：连上 Colyseus 房间，把状态变化和瞬时事件转成回调。场景和界面只和这里打交道，不直接碰 SDK。
import { Callbacks, Client, type Room } from '@colyseus/sdk';
import { EVENT, JOIN_TRIES, MSG, ROOM_FULL, ROOM_NAME, type Channel, type ChatLine } from '../shared/social.ts';
import type { CampusState, Player } from '../shared/state.ts';
import type { Weather } from '../shared/weather.ts';

/** 进房间后服务端发的第一条消息 */
export interface Hello {
  /** 出生点 */
  x: number;
  y: number;
  /** 在 players 里，别人看得见（登录了且房间没满） */
  visible: boolean;
  weather: Weather;
}

export interface NetHandlers {
  hello(h: Hello): void;
  add(id: string, p: Player, self: boolean): void;
  change(id: string, p: Player): void;
  remove(id: string): void;
  emote(id: string, emote: number): void;
  say(id: string, phrase: number): void;
  /** 服务端认为位置不合理，拉回到 (x, y) */
  snap(x: number, y: number): void;
  chat(line: ChatLine): void;
  history(ch: Channel, lines: ChatLine[]): void;
  notice(text: string): void;
  weather(w: Weather): void;
  left(code: number): void;
}

/** 位置上报的最短间隔（毫秒） */
const SEND_EVERY = 100;

export class Net {
  readonly room: Room<unknown, CampusState>;
  private last = { x: 0, y: 0, dir: -1, moving: false, t: 0 };
  private closing = false;

  private constructor(room: Room<unknown, CampusState>, h: NetHandlers) {
    this.room = room;
    const cb = Callbacks.get(room);
    cb.onAdd('players', (p, id) => {
      h.add(id, p, id === room.sessionId);
      cb.onChange(p, () => h.change(id, p));
    });
    cb.onRemove('players', (_p, id) => h.remove(id));
    room.onMessage(EVENT.hello, (m: Hello) => h.hello(m));
    room.onMessage(EVENT.emote, (m: { id: string; emote: number }) => h.emote(m.id, m.emote));
    room.onMessage(EVENT.say, (m: { id: string; phrase: number }) => h.say(m.id, m.phrase));
    room.onMessage(EVENT.snap, (m: { x: number; y: number }) => h.snap(m.x, m.y));
    room.onMessage(EVENT.chat, (m: ChatLine) => h.chat(m));
    room.onMessage(EVENT.history, (m: { ch: Channel; lines: ChatLine[] }) => h.history(m.ch, m.lines));
    room.onMessage(EVENT.notice, (m: { text: string }) => h.notice(m.text));
    room.onMessage(EVENT.weather, (m: Weather) => h.weather(m));
    room.onLeave((code: number) => !this.closing && h.left(code));
  }

  /** 服务地址：与页面同源的 /colyseus（开发时 Vite 代理，线上 nginx 代理） */
  static endpoint(): string {
    return new URL('colyseus', location.href).href.replace(/\/$/, '');
  }

  /** token 为空就以访客身份进 */
  static async join(token: string | null, h: NetHandlers): Promise<Net> {
    const client = new Client(Net.endpoint());
    const room = await joinRoom(client, token ? { token } : {});
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

  /** 骑上地图里编号为 id 的单车；0 是下车 */
  ride(id: number): void {
    this.room.send(MSG.ride, id);
  }

  chat(ch: Channel, text: string): void {
    this.room.send(MSG.chat, { ch, text });
  }

  history(ch: Channel): void {
    this.room.send(MSG.history, ch);
  }

  report(msg: number): void {
    this.room.send(MSG.report, msg);
  }

  block(uid: number, on: boolean): void {
    this.room.send(on ? MSG.block : MSG.unblock, uid);
  }

  /** 资料改完了，让房间按新资料更新外观 */
  profileChanged(): void {
    this.room.send(MSG.profile);
  }

  /** 主动离开（换账号重连），不触发 left 回调 */
  leave(): void {
    this.closing = true;
    void this.room.leave();
  }
}

/** 进房：房间刚满（很多人同时涌进来）就隔一小会儿重试，这时满的房间已经锁上，会进新的平行房间 */
export async function joinRoom(client: Client, options: { token?: string }): Promise<Room<unknown, CampusState>> {
  for (let k = 1; ; k++) {
    try {
      return await client.joinOrCreate<CampusState>(ROOM_NAME, options);
    } catch (e) {
      if ((e as { code?: number }).code !== ROOM_FULL || k >= JOIN_TRIES) throw e;
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 600 * k));
    }
  }
}
