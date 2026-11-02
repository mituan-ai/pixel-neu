// 压测：一批登录的机器人在校园里乱走、在附近频道说话，再加一批旁观的访客，统计往返延迟和收到的数据量。
//   node tools/loadtest.ts [玩家数 40] [访客数 200] [秒数 60] [服务地址 ws://127.0.0.1:2567]
// 机器人账号直接写进服务端的库（DB_FILE，默认 data/pixel-neu.db），只对开发库用，不要对线上库跑。
// 服务端要带 --dev 启动或配好 PHONE_SALT；机器人账号的手机号哈希是假的，用 tools/admin.ts find 机器人 能查到。
import { Callbacks, Client, type Room } from '@colyseus/sdk';
import { readFileSync } from 'node:fs';
import { Db } from '../server/db.ts';
import { MSG } from '../shared/social.ts';
import { joinRoom } from '../src/net.ts';
import type { CampusState } from '../shared/state.ts';
import { WALK_SPEED, Walkable, type TiledMap } from '../shared/world.ts';

const [players = 40, guests = 200, seconds = 60] = process.argv.slice(2, 5).map(Number);
const url = process.argv[5] ?? `ws://127.0.0.1:${process.env.PORT ?? 2567}`;
const map: TiledMap = JSON.parse(readFileSync(new URL('../assets/map.json', import.meta.url), 'utf8'));
const walk = new Walkable(map);
const db = new Db(process.env.DB_FILE ?? new URL('../data/pixel-neu.db', import.meta.url).pathname, 'loadtest');

const stats = { joined: 0, failed: 0, spectators: 0, snaps: 0, bytes: 0, patches: 0, rtt: [] as number[] };
const rooms: Room<unknown, CampusState>[] = [];

/** 一个玩家机器人：每 100 ms 走一步，撞墙就换方向；每 5–10 秒在附近频道说一句 */
async function player(i: number): Promise<void> {
  const { user } = db.userByPhone(`loadtest-${i}`);
  db.setProfile(user.id, `机器人${i}`, {});
  const token = `loadtest-${i}-${Date.now()}`;
  db.saveToken(token, user.id);
  const room = await joinRoom(new Client(url), { token });
  rooms.push(room);
  stats.joined++;
  room.onMessage('*', () => undefined);
  // 同时进来的人太多时少数人会被分成旁观者，这些机器人不走动
  const me = await new Promise<{ x: number; y: number } | null>((res) => {
    Callbacks.get(room).onAdd('players', (p, id) => id === room.sessionId && res({ x: p.x, y: p.y }));
    room.onMessage('hello', (h: { visible: boolean }) => !h.visible && res(null));
    setTimeout(() => res(null), 5000);
  });
  if (!me) return void stats.spectators++;
  let dir = Math.floor(Math.random() * 4);
  let pending: { x: number; t: number } | null = null;
  room.onMessage('snap', (m: { x: number; y: number }) => {
    stats.snaps++;
    me.x = m.x;
    me.y = m.y;
  });
  // 第一个机器人量往返延迟：发出去的位置出现在同步状态里用了多久
  if (i === 0)
    Callbacks.get(room).onChange(room.state.players.get(room.sessionId)!, () => {
      const p = room.state.players.get(room.sessionId)!;
      if (pending && p.x === pending.x) stats.rtt.push(performance.now() - pending.t), (pending = null);
    });
  const step = (WALK_SPEED * 100) / 1000;
  const move = setInterval(() => {
    const [dx, dy] = [[0, 1], [-1, 0], [1, 0], [0, -1]][dir];
    const x = me.x + dx * step, y = me.y + dy * step;
    if (walk.footBlocked(x, y) || Math.random() < 0.02) {
      dir = Math.floor(Math.random() * 4);
      return;
    }
    me.x = x;
    me.y = y;
    if (i === 0 && !pending) pending = { x: Math.fround(x), t: performance.now() };
    room.send(MSG.move, { x, y, dir, moving: true });
  }, 100);
  const talk = setInterval(() => room.send(MSG.chat, { ch: 'near', text: `第 ${Math.floor(Math.random() * 1000)} 号测试消息` }), 5000 + Math.random() * 5000);
  room.onLeave(() => (clearInterval(move), clearInterval(talk)));
}

/** 旁观的访客：只收状态，记下收到了多少字节 */
async function guest(): Promise<void> {
  const room = await joinRoom(new Client(url), {});
  rooms.push(room);
  stats.joined++;
  room.onMessage('*', () => undefined);
  const ws = (room.connection.transport as unknown as { ws?: WebSocket }).ws;
  ws?.addEventListener('message', (e) => {
    stats.patches++;
    stats.bytes += (e.data as ArrayBuffer).byteLength ?? 0;
  });
}

const t0 = Date.now();
const tasks: Promise<void>[] = [];
for (let i = 0; i < players; i++) tasks.push(player(i).catch((e) => (stats.failed++, console.error(`玩家 ${i}：`, e.message ?? e))));
for (let i = 0; i < guests; i++) tasks.push(guest().catch((e) => (stats.failed++, console.error('访客：', e.message ?? e))));
await Promise.all(tasks);
console.log(`进房 ${stats.joined}（玩家被分成旁观者 ${stats.spectators}），失败 ${stats.failed}，用时 ${Date.now() - t0} ms，房间 ${new Set(rooms.map((r) => r.roomId)).size} 个`);

const report = setInterval(() => {
  const rtt = stats.rtt.splice(0).sort((a, b) => a - b);
  const pct = (q: number) => (rtt.length ? rtt[Math.min(rtt.length - 1, Math.floor(rtt.length * q))].toFixed(0) : '-');
  console.log(
    `往返延迟 中位 ${pct(0.5)} ms / p95 ${pct(0.95)} ms；被拉回 ${stats.snaps} 次；每个访客每秒收 ${(stats.bytes / Math.max(1, guests) / 5 / 1024).toFixed(1)} KB、${(stats.patches / Math.max(1, guests) / 5).toFixed(1)} 条`,
  );
  stats.snaps = stats.bytes = stats.patches = 0;
}, 5000);

setTimeout(async () => {
  clearInterval(report);
  await Promise.all(rooms.map((r) => r.leave().catch(() => undefined)));
  process.exit(0);
}, seconds * 1000);
