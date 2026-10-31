// 联机服务器：只跑 Colyseus。网页静态文件由 Vite（开发）或 nginx（线上）提供，
// 两边都把 /colyseus/ 反向代理到这里（去掉前缀）。
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '../shared/social.ts';
import { CampusRoom } from './room.ts';

const PORT = Number(process.env.PORT ?? 2567);
const HOST = process.env.HOST ?? '127.0.0.1';

const server = new Server({ transport: new WebSocketTransport() });
// 满员后 joinOrCreate 会自动开一个新的平行房间
server.define(ROOM_NAME, CampusRoom);
await server.listen(PORT, HOST);
console.log(`像素东大联机服务器：ws://${HOST}:${PORT}`);
