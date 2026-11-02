// 房间同步状态（Colyseus schema）。服务端写，客户端只读。
// 加字段：在 Player 里追加，客户端在 src/net.ts 里读；表情、短语这类瞬时事件走消息，不进状态。
import { schema, t, type SchemaType } from '@colyseus/schema';

export const Player = schema(
  {
    name: t.string(),
    skin: t.uint8(),
    hair: t.uint8(),
    hairColor: t.uint8(),
    top: t.uint8(),
    bottom: t.uint8(),
    body: t.uint8(),
    topStyle: t.uint8(),
    bottomStyle: t.uint8(),
    /** 脚底的世界坐标（像素） */
    x: t.float32(),
    y: t.float32(),
    dir: t.uint8(),
    moving: t.boolean(),
    /** 账号编号：拉黑、举报用 */
    uid: t.uint32(),
    /** 正在骑的单车（地图物件编号），0 是步行 */
    ride: t.uint32(),
  },
  'Player',
);
export type Player = SchemaType<typeof Player>;

export const CampusState = schema(
  {
    players: t.map(Player),
  },
  'CampusState',
);
export type CampusState = SchemaType<typeof CampusState>;
