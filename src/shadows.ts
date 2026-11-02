// 实时投影：按太阳方位和高度，把楼（assets/heights.png，每米一格的屋面高度）和树（树冠椭圆）的影子
// 画进 128 m 见方的分块图（每米 2 像素），铺在地面上、一切站立物之下。只算镜头附近的块，每帧最多算一块；
// 太阳每分钟只走约 0.25°，方位或高度变化超过 0.5° 才整体重算。
import Phaser from 'phaser';
import type { Body } from '../shared/sky.ts';
import { TILE, METERS_PER_TILE } from '../shared/world.ts';

const PPM = TILE / METERS_PER_TILE;
/** 分块边长（米）、每米几个像素 */
const SIZE = 128;
const RES = 2;
/** 影子最长算到多少米 */
const MAX_LEN = 90;
/** 路网转正的角度：世界坐标的上方比真北偏了这么多（见 tools/geo.ts） */
const ROT = (3.85 * Math.PI) / 180;
/** 影子颜色 */
const COLOR = [29, 42, 70] as const;
const ALPHA = 92;

export interface Tree {
  x: number;
  y: number;
  /** 树冠半径、树冠中心离地高度（米） */
  r: number;
  h: number;
}

interface Chunk {
  key: string;
  img?: Phaser.GameObjects.Image;
  /** 算这块时用的太阳 */
  sun?: string;
}

export class Shadows {
  private readonly scene: Phaser.Scene;
  private heights: Uint8Array | null = null;
  private hw = 0;
  private hh = 0;
  private trees: Tree[] = [];
  private chunks = new Map<string, Chunk>();
  /** 当前太阳：方位角、高度角（度）和影子浓淡 0–1 */
  private sun: Body = { az: 180, alt: 45 };
  private strength = 1;
  private sunKey = '';
  private view = 0;
  private place: (x: number, y: number) => { x: number; y: number } = (x, y) => ({ x, y });
  private layer: Phaser.GameObjects.Layer;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    this.scene = scene;
    this.layer = layer;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = this.hw = img.width;
      c.height = this.hh = img.height;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      this.heights = new Uint8Array(img.width * img.height);
      for (let i = 0; i < this.heights.length; i++) this.heights[i] = d[i * 4];
      this.invalidate();
    };
    img.src = 'heights.png';
  }

  setTrees(t: Tree[]): void {
    this.trees = t;
    this.invalidate();
  }

  /** 换视角：分块图要按新视角重新摆 */
  setView(view: number, place: (x: number, y: number) => { x: number; y: number }): void {
    this.view = view;
    this.place = place;
    for (const c of this.chunks.values()) c.img && this.position(c);
  }

  /** strength 为 0 时不画影子（夜里、阴天） */
  setSun(sun: Body, strength: number): void {
    this.strength = strength;
    const key = `${Math.round(sun.az * 2)},${Math.round(sun.alt * 2)}`;
    this.sun = sun;
    for (const c of this.chunks.values()) c.img?.setAlpha(strength).setVisible(strength > 0.02);
    if (key !== this.sunKey) {
      this.sunKey = key;
      this.invalidate();
    }
  }

  private invalidate(): void {
    for (const c of this.chunks.values()) c.sun = undefined;
  }

  /** 每帧调用：mx0..my1 是镜头看到的世界范围（米） */
  update(mx0: number, my0: number, mx1: number, my1: number): void {
    if (!this.heights || this.strength <= 0.02 || this.sun.alt < 1) return;
    const c0 = Math.floor(mx0 / SIZE), r0 = Math.floor(my0 / SIZE), c1 = Math.floor(mx1 / SIZE), r1 = Math.floor(my1 / SIZE);
    const want = new Set<string>();
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) want.add(`${c},${r}`);
    // 离开视野两块以外的卸掉
    for (const [k, ch] of this.chunks) {
      const [c, r] = k.split(',').map(Number);
      if (c < c0 - 2 || c > c1 + 2 || r < r0 - 2 || r > r1 + 2) {
        ch.img?.destroy();
        if (this.scene.textures.exists(`sh${k}`)) this.scene.textures.remove(`sh${k}`);
        this.chunks.delete(k);
      }
    }
    // 每帧最多算一块，先算还没有图的
    let todo: Chunk | undefined;
    for (const k of want) {
      const ch = this.chunks.get(k) ?? { key: k };
      this.chunks.set(k, ch);
      if (ch.sun === this.sunKey) continue;
      if (!todo || (!ch.img && todo.img)) todo = ch;
    }
    if (todo) this.draw(todo);
  }

  private draw(ch: Chunk): void {
    const [c, r] = ch.key.split(',').map(Number);
    const N = SIZE * RES;
    const mask = new Uint8Array(N * N);
    const H = this.heights!;
    // 太阳方位换到世界坐标：真北顺时针 az → 世界里朝太阳的单位向量
    const az = (this.sun.az * Math.PI) / 180;
    const ex = Math.sin(az), ey = -Math.cos(az);
    const tx = ex * Math.cos(ROT) + ey * Math.sin(ROT), ty = -ex * Math.sin(ROT) + ey * Math.cos(ROT);
    const tan = Math.tan((Math.max(this.sun.alt, 1) * Math.PI) / 180);
    const L = Math.min(MAX_LEN, 255 / tan);
    // 地图左上角（EXTENT 西北角）在世界像素 0,0，高度图每米一格
    const ox = c * SIZE, oy = r * SIZE;
    for (let v = 0; v < N; v++)
      for (let u = 0; u < N; u++) {
        const mx = ox + (u + 0.5) / RES, my = oy + (v + 0.5) / RES;
        // 往太阳方向一米一米找：哪一格的屋面高过视线，这里就在影子里
        for (let k = 1; k <= L; k++) {
          const sx = (mx + tx * k) | 0, sy = (my + ty * k) | 0;
          if (sx < 0 || sy < 0 || sx >= this.hw || sy >= this.hh) break;
          const h = H[sy * this.hw + sx];
          if (h && h > k * tan) {
            mask[v * N + u] = 1;
            break;
          }
        }
      }
    // 树：树冠当成悬在半空的球，影子是沿影子方向拉长的椭圆，再加一条树干的影子
    const dx = -tx, dy = -ty;
    for (const t of this.trees) {
      const len = t.h / tan;
      const cx = t.x + dx * len, cy = t.y + dy * len;
      const along = Math.min(t.r / Math.sin((Math.max(this.sun.alt, 1) * Math.PI) / 180), t.r * 4);
      const reach = along + t.r + 1;
      if (cx + reach < ox || cx - reach > ox + SIZE || cy + reach < oy || cy - reach > oy + SIZE) continue;
      const u0 = Math.max(0, Math.floor((cx - reach - ox) * RES)), u1 = Math.min(N - 1, Math.ceil((cx + reach - ox) * RES));
      const v0 = Math.max(0, Math.floor((cy - reach - oy) * RES)), v1 = Math.min(N - 1, Math.ceil((cy + reach - oy) * RES));
      for (let v = v0; v <= v1; v++)
        for (let u = u0; u <= u1; u++) {
          const px = ox + (u + 0.5) / RES - cx, py = oy + (v + 0.5) / RES - cy;
          const a = px * dx + py * dy, b = -px * dy + py * dx;
          if ((a * a) / (along * along) + (b * b) / (t.r * t.r) <= 1) mask[v * N + u] = 1;
        }
      const steps = Math.ceil(len * RES);
      for (let s = 0; s < steps; s++) {
        const u = Math.floor((t.x + (dx * s) / RES - ox) * RES), v = Math.floor((t.y + (dy * s) / RES - oy) * RES);
        if (u >= 0 && v >= 0 && u < N && v < N) mask[v * N + u] = 1;
      }
    }
    const key = `sh${ch.key}`;
    const tex = this.scene.textures.exists(key) ? (this.scene.textures.get(key) as Phaser.Textures.CanvasTexture) : this.scene.textures.createCanvas(key, N, N)!;
    const img = tex.context.createImageData(N, N);
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) {
        img.data[i * 4] = COLOR[0];
        img.data[i * 4 + 1] = COLOR[1];
        img.data[i * 4 + 2] = COLOR[2];
        img.data[i * 4 + 3] = ALPHA;
      }
    tex.context.putImageData(img, 0, 0);
    tex.refresh();
    if (!ch.img) {
      ch.img = this.scene.add.image(0, 0, key).setScale(PPM / RES).setDepth(-7);
      this.layer.add(ch.img);
      this.position(ch);
    }
    ch.img.setAlpha(this.strength).setVisible(true);
    ch.sun = this.sunKey;
  }

  private position(ch: Chunk): void {
    const [c, r] = ch.key.split(',').map(Number);
    const span = SIZE * PPM;
    const p = this.place(c * span + span / 2, r * span + span / 2);
    ch.img!.setPosition(p.x, p.y).setAngle(-90 * this.view);
  }

  /** 夜里或关掉时全部藏起来 */
  hide(): void {
    for (const c of this.chunks.values()) c.img?.setVisible(false);
  }
}
