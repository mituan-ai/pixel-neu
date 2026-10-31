// 角色外观、表情、快捷短语与联机消息。只放数据和校验，渲染与网络各自实现。
// 加新选项：往数组末尾追加（下标就是存档和网络里的值，不要插队或删除），再补对应的美术。

export const ROOM_NAME = 'campus';
/** 一个“平行校园”的人数上限，满了自动开新房间 */
export const ROOM_MAX = 40;

export const SKIN = [0xf5d2b0, 0xe8b48c, 0xc98e63, 0x8f5b3c];
export const HAIR_STYLE = ['短发', '中分', '马尾', '长发', '寸头'];
export const HAIR_COLOR = [0x2b2430, 0x5b3a29, 0x9a6a3c, 0xd9c08a, 0x8a8f99, 0x7a3b46];
export const TOP_COLOR = [0xe9edf2, 0x3d5a9e, 0xc0463e, 0x4e8a52, 0xe0b040, 0x2d2f3a, 0x8a5cb8, 0xe58aa8];
export const BOTTOM_COLOR = [0x2f3b55, 0x4a4f5c, 0x6b5a46, 0xb9a98a, 0x1f2128];

export interface Look {
  skin: number;
  hair: number;
  hairColor: number;
  top: number;
  bottom: number;
}

export const DEFAULT_LOOK: Look = { skin: 0, hair: 0, hairColor: 0, top: 1, bottom: 0 };

/**
 * 角色精灵表 assets/avatar.png 的布局：一帧 16×24，脚底在底边中点；
 * 每列一帧（0 站立、1 迈左脚、2 迈右脚），每行 = 部件起始行 + 朝向（头发再按发型每 4 行一组）。
 */
export const AVATAR = {
  w: 16,
  h: 24,
  frames: 3,
  rows: { skin: 0, bottom: 4, top: 8, detail: 12, hair: 16 },
} as const;

const clampIndex = (v: unknown, n: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : 0);

export function cleanLook(raw: Partial<Look> | undefined): Look {
  const r = raw ?? {};
  return {
    skin: clampIndex(r.skin, SKIN.length),
    hair: clampIndex(r.hair, HAIR_STYLE.length),
    hairColor: clampIndex(r.hairColor, HAIR_COLOR.length),
    top: clampIndex(r.top, TOP_COLOR.length),
    bottom: clampIndex(r.bottom, BOTTOM_COLOR.length),
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
