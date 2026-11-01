// 角色外观、表情、快捷短语与联机消息。只放数据和校验，渲染与网络各自实现。
// 加新选项：往数组末尾追加（下标就是存档和网络里的值，不要插队或删除），再补对应的美术。

export const ROOM_NAME = 'campus';
/** 一个“平行校园”的人数上限，满了自动开新房间 */
export const ROOM_MAX = 40;

export const BODY = ['男', '女'];
export const SKIN = [0xf5d2b0, 0xe8b48c, 0xc98e63, 0x8f5b3c];
export const HAIR_STYLE = ['短发', '寸头', '中分', '刺猬头', '中长发', '马尾', '侧马尾', '麻花辫', '侧编辫', '卷发', '爆炸头'];
export const HAIR_COLOR = [0x3a3340, 0x5b3a29, 0x9a6a3c, 0xd9c08a, 0x8a8f99, 0x7a3b46];
export const TOP_STYLE = ['T恤', '长袖', 'Polo衫'];
export const TOP_COLOR = [0xe9edf2, 0x3d5a9e, 0xc0463e, 0x4e8a52, 0xe0b040, 0x2d2f3a, 0x8a5cb8, 0xe58aa8];
export const BOTTOM_STYLE = ['长裤', '短裤', '裙子'];
export const BOTTOM_COLOR = [0x2f3b55, 0x4a4f5c, 0x6b5a46, 0xb9a98a, 0x1f2128];

export interface Look {
  skin: number;
  hair: number;
  hairColor: number;
  top: number;
  bottom: number;
  body: number;
  topStyle: number;
  bottomStyle: number;
}

export const DEFAULT_LOOK: Look = { skin: 0, hair: 0, hairColor: 0, top: 1, bottom: 0, body: 0, topStyle: 0, bottomStyle: 0 };

/**
 * 角色精灵表 assets/avatar.png（Q 版 24×32 部件，见 art/chibi/）：一帧 24×32，脚底在第 30 行，按 1 倍显示。
 * 每个部件变体占一「块」：4 行（下、左、右、上）× 3 帧（1 站立，0、2 迈步）。块从上往下排满 rowsPerColumn 行就换下一列
 */
export const AVATAR = { w: 24, h: 32, frames: 3, scale: 1, footY: 30, idle: 1, columns: 4, rowsPerColumn: 32 } as const;

/** 各部件的起始块号：身体（含头）、鞋、眼睛按体型，衣服按款式 × 体型，头发每种发型一块 */
export const AVATAR_BLOCK = {
  body: 0,
  feet: 2,
  eyes: 4,
  legs: 6,
  torso: 6 + BOTTOM_STYLE.length * 2,
  hair: 6 + (BOTTOM_STYLE.length + TOP_STYLE.length) * 2,
} as const;

type Tint = 'skin' | 'hair' | 'top' | 'bottom';
/** 从下往上叠的部件：取哪一块，染什么颜色（不染的保留原色） */
export const AVATAR_PARTS: { block: (l: Look) => number; tint?: Tint }[] = [
  { block: (l) => AVATAR_BLOCK.body + l.body, tint: 'skin' },
  { block: (l) => AVATAR_BLOCK.feet + l.body },
  { block: (l) => AVATAR_BLOCK.legs + l.bottomStyle * 2 + l.body, tint: 'bottom' },
  { block: (l) => AVATAR_BLOCK.torso + l.topStyle * 2 + l.body, tint: 'top' },
  { block: (l) => AVATAR_BLOCK.eyes + l.body },
  { block: (l) => AVATAR_BLOCK.hair + l.hair, tint: 'hair' },
];

export function tintOf(l: Look, t: Tint): number {
  return t === 'skin' ? SKIN[l.skin] : t === 'hair' ? HAIR_COLOR[l.hairColor] : t === 'top' ? TOP_COLOR[l.top] : BOTTOM_COLOR[l.bottom];
}

/** 第 block 块、朝向 dir、第 f 帧在 avatar.png 里的帧号（按 w×h 切格，从左到右、从上到下数） */
export function avatarFrame(block: number, dir: number, f: number): number {
  const line = block * 4 + dir;
  const col = Math.floor(line / AVATAR.rowsPerColumn), row = line % AVATAR.rowsPerColumn;
  return row * AVATAR.columns * AVATAR.frames + col * AVATAR.frames + f;
}

const clampIndex = (v: unknown, n: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : 0);

export function cleanLook(raw: Partial<Look> | undefined): Look {
  const r = raw ?? {};
  return {
    skin: clampIndex(r.skin, SKIN.length),
    hair: clampIndex(r.hair, HAIR_STYLE.length),
    hairColor: clampIndex(r.hairColor, HAIR_COLOR.length),
    top: clampIndex(r.top, TOP_COLOR.length),
    bottom: clampIndex(r.bottom, BOTTOM_COLOR.length),
    body: clampIndex(r.body, BODY.length),
    topStyle: clampIndex(r.topStyle, TOP_STYLE.length),
    bottomStyle: clampIndex(r.bottomStyle, BOTTOM_STYLE.length),
  };
}

export const NAME_MAX = 12;

/** 昵称：去掉控制字符和首尾空白，限长；空了就给一个默认名 */
export function cleanName(raw: unknown): string {
  const s = String(raw ?? '')
    .replace(/[\p{C}]/gu, '')
    .trim();
  return [...s].slice(0, NAME_MAX).join('') || '东大人';
}

/** 表情：头顶气泡里的像素图标，图标在 assets/emotes.png 里按这个顺序排 */
export const EMOTES = ['挥手', '开心', '爱心', '疑问', '惊讶', '点赞'];

/**
 * 快捷短语。第一阶段不开放自由文字聊天（自由文字需要内容审核），只发这里的短语。
 * 网络里只传下标。
 */
export const PHRASES = [
  '你好！',
  '同学你好～',
  '一起去图书馆吗？',
  '我在北门',
  '我在信息学馆',
  '我在图书馆门口',
  '来合个影！',
  '跟我来',
  '等等我',
  '谢谢！',
  '哈哈哈',
  '回头见！',
];

/** 联机消息名，客户端发、服务端收 */
export const MSG = { move: 'move', emote: 'emote', say: 'say' } as const;

/** 服务端广播给其他人的瞬时事件 */
export const EVENT = { emote: 'emote', say: 'say', snap: 'snap' } as const;

/** 朝向：与角色精灵表的行顺序一致 */
export const DIR = { down: 0, left: 1, right: 2, up: 3 } as const;

/** 同一个人发表情或短语的最短间隔（毫秒） */
export const CHAT_COOLDOWN = 800;
