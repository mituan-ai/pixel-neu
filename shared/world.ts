// 客户端、服务端、工具共用的世界常量与地图读取。改这里的数会同时影响三方，改前看 AGENTS.md。

/** 一格的像素边长；一格 = METERS_PER_TILE 米（全图统一比例，不压缩距离） */
export const TILE = 16;
export const METERS_PER_TILE = 2;

/** 步行速度（像素/秒）。真实步速太慢不好玩，这里约 5 格/秒 */
export const WALK_SPEED = 80;

/** 角色脚下的碰撞盒（像素，以脚底中心为原点） */
export const FOOT = { w: 10, h: 6 };

/** 地图图层名：工具生成、客户端渲染、服务端校验都按这些名字找 */
export const LAYER = { ground: 'ground', edges: 'edges', blocked: 'blocked', objects: 'objects' } as const;

/** Tiled JSON 里我们用到的部分 */
export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  properties?: TiledProperty[];
}
export interface TiledProperty {
  name: string;
  type: string;
  value: string | number | boolean;
}
export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  point?: boolean;
  properties?: TiledProperty[];
}
export type TiledLayer =
  | { type: 'tilelayer'; name: string; width: number; height: number; data: number[]; visible: boolean }
  | { type: 'objectgroup'; name: string; objects: TiledObject[]; visible: boolean };

export function prop<T extends string | number | boolean>(o: { properties?: TiledProperty[] }, name: string, fallback: T): T {
  const p = o.properties?.find((q) => q.name === name);
  return (p ? p.value : fallback) as T;
}

/** 不可走的格子（建筑脚下、墙、水、校外等），客户端碰撞和服务端校验用同一份 */
export class Walkable {
  readonly w: number;
  readonly h: number;
  private readonly blocked: Uint8Array;

  constructor(map: TiledMap) {
    const layer = map.layers.find((l) => l.name === LAYER.blocked);
    if (!layer || layer.type !== 'tilelayer') throw new Error('地图缺少 blocked 图层');
    this.w = layer.width;
    this.h = layer.height;
    this.blocked = Uint8Array.from(layer.data, (g) => (g ? 1 : 0));
  }

  tileBlocked(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return true;
    return this.blocked[ty * this.w + tx] === 1;
  }

  /** 脚底在 (x, y) 时碰撞盒是否碰到不可走的格子 */
  footBlocked(x: number, y: number): boolean {
    const x0 = Math.floor((x - FOOT.w / 2) / TILE);
    const x1 = Math.floor((x + FOOT.w / 2 - 1) / TILE);
    const y0 = Math.floor((y - FOOT.h) / TILE);
    const y1 = Math.floor((y - 1) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.tileBlocked(tx, ty)) return true;
    return false;
  }

  /**
   * 点击行走的路线：按格子做广度优先搜索（八方向，不切墙角），再把能直着走的段落拉直。
   * 终点不可走时改去离它最近的可走格。返回途经的脚底坐标（不含起点），走不到返回空数组。
   */
  path(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
    const tile = (x: number, y: number) => [Math.floor(x / TILE), Math.floor((y - 1) / TILE)];
    const [sx, sy] = tile(x0, y0);
    let [gx, gy] = tile(x1, y1);
    if (this.tileBlocked(gx, gy)) {
      const near = this.nearestFree(gx, gy);
      if (!near) return [];
      [gx, gy] = near;
      x1 = gx * TILE + TILE / 2;
      y1 = (gy + 1) * TILE - 4;
    }
    const start = sy * this.w + sx, goal = gy * this.w + gx;
    if (start === goal) return this.footBlocked(x1, y1) ? [] : [{ x: x1, y: y1 }];
    const from = new Int32Array(this.w * this.h).fill(-1);
    from[start] = start;
    const queue = [start];
    for (let head = 0; head < queue.length && from[goal] < 0; head++) {
      const i = queue[head], cx = i % this.w, cy = (i - cx) / this.w;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = cx + dx, ny = cy + dy, j = ny * this.w + nx;
        if (this.tileBlocked(nx, ny) || from[j] >= 0) continue;
        if (dx && dy && (this.tileBlocked(cx + dx, cy) || this.tileBlocked(cx, cy + dy))) continue;
        from[j] = i;
        queue.push(j);
      }
    }
    if (from[goal] < 0) return [];
    const tiles: { x: number; y: number }[] = [];
    for (let i = goal; i !== start; i = from[i]) tiles.push({ x: (i % this.w) * TILE + TILE / 2, y: (Math.floor(i / this.w) + 1) * TILE - 4 });
    tiles.reverse();
    tiles[tiles.length - 1] = { x: x1, y: y1 };
    if (this.footBlocked(x1, y1)) tiles[tiles.length - 1] = { x: gx * TILE + TILE / 2, y: (gy + 1) * TILE - 4 };
    // 拉直：从当前点尽量往后找一个能直线走到的点
    const out: { x: number; y: number }[] = [];
    let cur = { x: x0, y: y0 };
    for (let k = 0; k < tiles.length; ) {
      let far = k;
      while (far + 1 < tiles.length && this.clear(cur, tiles[far + 1])) far++;
      cur = tiles[far];
      out.push(cur);
      k = far + 1;
    }
    return out;
  }

  /** 两点之间直线走，碰撞盒会不会碰到障碍（每 2 像素采样一次） */
  private clear(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2);
    for (let k = 1; k <= n; k++) if (this.footBlocked(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n)) return false;
    return true;
  }

  private nearestFree(tx: number, ty: number): [number, number] | null {
    for (let r = 1; r <= 6; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r && !this.tileBlocked(tx + dx, ty + dy)) return [tx + dx, ty + dy];
    return null;
  }
}

const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
