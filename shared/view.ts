// 四个视角：屏幕上方朝北、东、南、西。只用于显示（客户端画面和美术生成），
// 服务端、碰撞、寻路、网络同步一律用世界坐标。
import { DIR } from './social.ts';

/** 视角编号 = 屏幕上方的地理方向：0 北、1 东、2 南、3 西 */
export const VIEWS = [0, 1, 2, 3] as const;
export type View = (typeof VIEWS)[number];
/** 美术文件名里的视角后缀 */
export const VIEW_NAME = ['N', 'E', 'S', 'W'] as const;

/** 世界坐标（宽 W、高 H 的矩形内）→ 视角坐标。整格矩形旋转后仍是整格 */
export function toView(v: View, W: number, H: number, x: number, y: number): { x: number; y: number } {
  switch (v) {
    case 0: return { x, y };
    case 1: return { x: y, y: W - x };
    case 2: return { x: W - x, y: H - y };
    case 3: return { x: H - y, y: x };
  }
}

/** 视角坐标 → 世界坐标 */
export function fromView(v: View, W: number, H: number, x: number, y: number): { x: number; y: number } {
  switch (v) {
    case 0: return { x, y };
    case 1: return { x: W - y, y: x };
    case 2: return { x: W - x, y: H - y };
    case 3: return { x: y, y: H - x };
  }
}

/** 视角下的宽高 */
export const viewSize = (v: View, W: number, H: number) => (v % 2 ? { w: H, h: W } : { w: W, h: H });

/** 格子 (c, r) 在视角下的格子（cols × rows 的网格） */
export function cellToView(v: View, cols: number, rows: number, c: number, r: number): [number, number] {
  const p = toView(v, cols, rows, c + 0.5, r + 0.5);
  return [Math.floor(p.x), Math.floor(p.y)];
}

/** 把按行存的网格（rows[r][c]）转到视角下 */
export function rotateGrid<T>(v: View, grid: T[][]): T[][] {
  const rows = grid.length, cols = grid[0].length;
  const s = viewSize(v, cols, rows);
  const out: T[][] = Array.from({ length: s.h }, () => new Array<T>(s.w));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const [vc, vr] = cellToView(v, cols, rows, c, r);
      out[vr][vc] = grid[r][c];
    }
  return out;
}

/** 屏幕朝下的那一面朝向哪个地理方向：上北时看到南立面 */
export const FACING = ['S', 'W', 'N', 'E'] as const;

// 角色朝向 DIR（下、左、右、上 = 世界南、西、东、北）与罗盘序号（北 0 东 1 南 2 西 3）互换
const DIR_TO_COMPASS = { [DIR.up]: 0, [DIR.right]: 1, [DIR.down]: 2, [DIR.left]: 3 } as Record<number, number>;
const COMPASS_TO_DIR = [DIR.up, DIR.right, DIR.down, DIR.left];

/** 世界朝向 → 视角下的屏幕朝向 */
export const dirToView = (v: View, d: number) => COMPASS_TO_DIR[(DIR_TO_COMPASS[d] - v + 4) % 4];
/** 屏幕朝向 → 世界朝向 */
export const dirFromView = (v: View, d: number) => COMPASS_TO_DIR[(DIR_TO_COMPASS[d] + v) % 4];
