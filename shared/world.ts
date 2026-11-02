// 客户端、服务端、工具共用的世界常量与地图读取。改这里的数会同时影响三方，改前看 AGENTS.md。

/** 一格的像素边长；一格 = METERS_PER_TILE 米，即 1 m = 8 px。地面和楼高同一比例 */
export const TILE = 16;
export const METERS_PER_TILE = 2;
/** 碰撞格的像素边长：1 m 一格，比地面格细一倍，墙脚和路沿的误差在半米以内 */
export const CELL = 8;
/** 地面分块图（assets/ground/<列>-<行>.png）的像素边长，地图右边和下边的块可能更小 */
export const GROUND_CHUNK = 512;

/** 步行速度（像素/秒）：约 10 m/s，北门走到图书馆半分钟出头 */
export const WALK_SPEED = 80;
/** 开发者模式按住 Shift 的加速倍数：客户端只在 Vite 开发时启用，服务端只在带 --dev 启动时放行 */
export const DEV_BOOST = 5;
/** 骑车的速度是步行的几倍；离单车多近才能骑上（像素，3 m） */
export const RIDE_FACTOR = 2.5;
export const RIDE_REACH = 24;

/** 地图里能骑的车：物件名「v:车型:车色号」里车型是自行车或共享单车的 */
export const isRideable = (sprite: string) => /^v:(bike-|share-)/.test(sprite);

/** 角色脚下的碰撞盒（像素，以脚底中心为原点） */
export const FOOT = { w: 10, h: 6 };

/** 地图图层名：工具生成、客户端渲染、服务端校验都按这些名字找。地面不在地图里，是烘焙好的分块图 */
export const LAYER = { blocked: 'blocked', objects: 'objects' } as const;

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
  /** 折线各点，相对 (x, y) */
  polyline?: { x: number; y: number }[];
  properties?: TiledProperty[];
}
/**
 * runs：碰撞格（CELL 见方，width × height 格）按行展开后的行程编码，从「可走」开始，可走、不可走交替的长度。
 * 不是 Tiled 的标准图层，只有我们自己读
 */
export type TiledLayer =
  | { type: 'runs'; name: string; width: number; height: number; runs: number[] }
  | { type: 'objectgroup'; name: string; objects: TiledObject[]; visible: boolean };

export function prop<T extends string | number | boolean>(o: { properties?: TiledProperty[] }, name: string, fallback: T): T {
  const p = o.properties?.find((q) => q.name === name);
  return (p ? p.value : fallback) as T;
}

/** 不可走的碰撞格（建筑脚下、墙、水、校外等，1 m 一格），客户端碰撞和服务端校验用同一份 */
export class Walkable {
  readonly w: number;
  readonly h: number;
  private readonly blocked: Uint8Array;

  constructor(map: TiledMap) {
    const layer = map.layers.find((l) => l.name === LAYER.blocked);
    if (!layer || layer.type !== 'runs') throw new Error('地图缺少 blocked 图层');
    this.w = layer.width;
    this.h = layer.height;
    this.blocked = new Uint8Array(this.w * this.h);
    let at = 0;
    layer.runs.forEach((n, k) => {
      if (k % 2) this.blocked.fill(1, at, at + n);
      at += n;
    });
  }

  tileBlocked(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return true;
    return this.blocked[ty * this.w + tx] === 1;
  }

  /** 脚底在 (x, y) 时碰撞盒是否碰到不可走的格子 */
  footBlocked(x: number, y: number): boolean {
    const x0 = Math.floor((x - FOOT.w / 2) / CELL);
    const x1 = Math.floor((x + FOOT.w / 2 - 1) / CELL);
    const y0 = Math.floor((y - FOOT.h) / CELL);
    const y1 = Math.floor((y - 1) / CELL);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.tileBlocked(tx, ty)) return true;
    return false;
  }

  /**
   * 点击行走的路线：按格子做广度优先搜索（八方向，不切墙角），再把能直着走的段落拉直。
   * 碰撞盒比一格宽，所以只走「站得下」的格子：脚底放在格子下沿正中时碰撞盒不碰障碍。
   * 终点不可走时改去离它最近的站得下的格。返回途经的脚底坐标（不含起点），走不到返回空数组。
   */
  path(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
    const tile = (x: number, y: number) => [Math.floor(x / CELL), Math.floor((y - 1) / CELL)];
    const foot = (c: number, r: number) => ({ x: c * CELL + CELL / 2, y: (r + 1) * CELL - 1 });
    const [sx, sy] = tile(x0, y0);
    let [gx, gy] = tile(x1, y1);
    if (!this.canStand(gx, gy)) {
      const near = this.nearestFree(gx, gy);
      if (!near) return [];
      [gx, gy] = near;
      ({ x: x1, y: y1 } = foot(gx, gy));
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
        if (!this.canStand(nx, ny) || from[j] >= 0) continue;
        if (dx && dy && (!this.canStand(cx + dx, cy) || !this.canStand(cx, cy + dy))) continue;
        from[j] = i;
        queue.push(j);
      }
    }
    if (from[goal] < 0) return [];
    const tiles: { x: number; y: number }[] = [];
    for (let i = goal; i !== start; i = from[i]) tiles.push(foot(i % this.w, Math.floor(i / this.w)));
    tiles.reverse();
    tiles[tiles.length - 1] = { x: x1, y: y1 };
    if (this.footBlocked(x1, y1)) tiles[tiles.length - 1] = foot(gx, gy);
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

  /** 每格站不站得下（寻路时才算，服务端用不到） */
  private stand?: Uint8Array;
  private canStand(c: number, r: number): boolean {
    if (c < 0 || r < 0 || c >= this.w || r >= this.h) return false;
    if (!this.stand) {
      this.stand = new Uint8Array(this.w * this.h);
      for (let rr = 0; rr < this.h; rr++)
        for (let cc = 0; cc < this.w; cc++) this.stand[rr * this.w + cc] = this.footBlocked(cc * CELL + CELL / 2, (rr + 1) * CELL - 1) ? 0 : 1;
    }
    return this.stand[r * this.w + c] === 1;
  }

  /**
   * 服务端校验用：两次上报之间能不能走过去。客户端贴墙时按轴分开滑动，
   * 所以直线、先横后竖、先竖后横三条路有一条走得通就算合法
   */
  reachable(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    const h = { x: b.x, y: a.y }, v = { x: a.x, y: b.y };
    return this.clear(a, b) || (this.clear(a, h) && this.clear(h, b)) || (this.clear(a, v) && this.clear(v, b));
  }

  /** 两点之间直线走，碰撞盒会不会碰到障碍（每 2 像素采样一次） */
  private clear(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2);
    for (let k = 1; k <= n; k++) if (this.footBlocked(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n)) return false;
    return true;
  }

  private nearestFree(tx: number, ty: number): [number, number] | null {
    for (let r = 1; r <= 12; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r && this.canStand(tx + dx, ty + dy)) return [tx + dx, ty + dy];
    return null;
  }
}

const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
