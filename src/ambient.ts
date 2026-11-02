// 校园生态：喜鹊、麻雀、猫、狗和路上行驶的车。全在客户端，不占网络。
// 每只动物的家（哪棵树、哪个楼门、哪条路）和车的出发位置按「北京时间的日期 + 编号」算，所有人看到的大体一样；
// 之后的走动、被惊飞、给人让路只在本地发生。视野外的活物不更新也不画。
import Phaser from 'phaser';
import { faunaKey, FAUNA } from '../shared/fauna.ts';
import { DIR } from '../shared/social.ts';
import { VEHICLES, vehicleKey } from '../shared/vehicles.ts';
import { dirToView, type View } from '../shared/view.ts';
import { TILE, type Walkable } from '../shared/world.ts';

const PPM = TILE / 2;
/** 飞着的鸟画在一切之上（角色的透视影子之下） */
const SKY_DEPTH = 5e5;

export interface AmbientTree {
  /** 树干脚底（世界像素）和树冠中心离地高度（米） */
  x: number;
  y: number;
  h: number;
}
export interface AmbientDoor {
  x: number;
  y: number;
  facing: number;
}
export interface Person {
  x: number;
  y: number;
  moving: boolean;
  self: boolean;
}
export interface AmbientWorld {
  walk: Walkable;
  trees: AmbientTree[];
  doors: AmbientDoor[];
  /** 车道折线（世界像素） */
  lanes: { x: number; y: number }[][];
  toView: (x: number, y: number) => { x: number; y: number };
}

/** 可复现的随机数 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
/** 北京时间的日期 */
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** 世界方向向量 → 世界朝向（DIR） */
function dirOf(dx: number, dy: number, fallback: number): number {
  if (!dx && !dy) return fallback;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIR.right : DIR.left) : dy > 0 ? DIR.down : DIR.up;
}

interface Mob {
  img: Phaser.GameObjects.Image;
  species: string;
  variant: number;
  x: number;
  y: number;
  dir: number;
  state: string;
  /** 离地高度（像素，鸟用） */
  alt: number;
  /** 当前状态还剩多久（秒） */
  until: number;
  anim: number;
  /** 走向的目标；鸟飞向的目标高度 */
  tx: number;
  ty: number;
  talt: number;
  speed: number;
  /** 栖在树上时，树的脚底 y（遮挡用） */
  perchY?: number;
  hx: number;
  hy: number;
  rand: () => number;
}

interface Flock {
  birds: Mob[];
  species: 'magpie' | 'sparrow';
  tree?: AmbientTree;
}

interface Car {
  img: Phaser.GameObjects.Image;
  id: string;
  paint: number;
  lane: number;
  s: number;
  sdir: 1 | -1;
  wait: number;
  anim: number;
  x: number;
  y: number;
  dir: number;
}

/** 每个物种每种动作的帧数，从目录里查 */
const FRAMES = Object.fromEntries(FAUNA.map((s) => [s.id, s.states]));

export class Ambient {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Layer;
  private readonly world: AmbientWorld;
  private flocks: Flock[] = [];
  private cats: Mob[] = [];
  private dogs: { mob: Mob; lane: number; s: number; sdir: 1 | -1 }[] = [];
  private cars: Car[] = [];
  private laneLen: number[][] = [];
  private view: View = 0;
  private shade = 0xffffff;
  private night = false;
  private wet = false;
  private heart?: { img: Phaser.GameObjects.Image; cat: Mob; until: number };
  private petCooldown = 0;
  private stillFor = 0;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, world: AmbientWorld) {
    this.scene = scene;
    this.layer = layer;
    this.world = world;
    this.laneLen = world.lanes.map((l) => {
      const acc = [0];
      for (let i = 1; i < l.length; i++) acc.push(acc[i - 1] + Math.hypot(l[i].x - l[i - 1].x, l[i].y - l[i - 1].y));
      return acc;
    });
    this.spawn();
  }

  private image(atlas: string): Phaser.GameObjects.Image {
    const img = this.scene.add.image(0, 0, atlas, '__BASE').setVisible(false).setTint(this.shade);
    this.layer.add(img);
    return img;
  }

  private mob(species: string, variant: number, x: number, y: number, seed: number, state: string): Mob {
    return { img: this.image('fauna'), species, variant, x, y, dir: DIR.down, state, alt: 0, until: 0, anim: 0, tx: x, ty: y, talt: 0, speed: 0, hx: x, hy: y, rand: rng(seed) };
  }

  private free(x: number, y: number): boolean {
    return !this.world.walk.tileBlocked(Math.floor(x / PPM), Math.floor(y / PPM));
  }

  /** 在 (x, y) 附近 r 像素内找一个能站的点 */
  private near(x: number, y: number, r: number, rand: () => number): { x: number; y: number } | null {
    for (let k = 0; k < 12; k++) {
      const a = rand() * Math.PI * 2, d = r * Math.sqrt(rand());
      const p = { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d };
      if (this.free(p.x, p.y)) return p;
    }
    return null;
  }

  private spawn(): void {
    const day = hashStr(today());
    const r = rng(day);
    const { trees, doors, lanes } = this.world;
    // 喜鹊：三五只一群，落在树下；麻雀：四到六只一群
    const groups: [Flock['species'], number, number, number][] = [
      ['magpie', 14, 3, 5],
      ['sparrow', 18, 4, 6],
    ];
    for (const [species, n, lo, hi] of groups)
      for (let i = 0; i < n && trees.length; i++) {
        const tree = trees[Math.floor(r() * trees.length)];
        const flock: Flock = { birds: [], species, tree };
        const size = lo + Math.floor(r() * (hi - lo + 1));
        for (let k = 0; k < size; k++) {
          const b = this.mob(species, 0, tree.x, tree.y, day + i * 97 + k, 'stand');
          const p = this.near(tree.x, tree.y, 5 * PPM, b.rand);
          if (!p) continue;
          b.x = b.tx = p.x;
          b.y = b.ty = p.y;
          b.dir = Math.floor(b.rand() * 4);
          b.until = b.rand() * 4;
          flock.birds.push(b);
        }
        this.flocks.push(flock);
      }
    // 猫：六种花色各一只，家在某个楼门边上
    const DOOR_OUT = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    FAUNA.find((s) => s.id === 'cat')!.variants.forEach((_, v) => {
      if (!doors.length) return;
      const d = doors[Math.floor(r() * doors.length)];
      const [ox, oy] = DOOR_OUT[d.facing];
      const hx = d.x + ox * 2 * PPM + (r() - 0.5) * 4 * PPM, hy = d.y + oy * 2 * PPM + (r() - 0.5) * 4 * PPM;
      if (!this.free(hx, hy)) return;
      const c = this.mob('cat', v, hx, hy, day + 1000 + v, 'sit');
      this.cats.push(c);
    });
    // 狗：两只，沿路边慢慢走
    for (let i = 0; i < 2 && lanes.length; i++) {
      const lane = Math.floor(r() * lanes.length);
      const m = this.mob('dog', i, 0, 0, day + 2000 + i, 'walk');
      this.dogs.push({ mob: m, lane, s: r() * this.laneLen[lane].at(-1)!, sdir: r() < 0.5 ? 1 : -1 });
    }
    // 车：挑最长的几条路，每条一辆，车型按目录随机，新能源车约三成
    const order = lanes.map((_, i) => i).sort((a, b) => this.laneLen[b].at(-1)! - this.laneLen[a].at(-1)!);
    const cars = VEHICLES.filter((v) => v.group === 'fuel' || v.group === 'nev' || v.group === 'special');
    for (const lane of order.slice(0, 5)) {
      const v = r() < 0.3 ? cars.filter((c) => c.group === 'nev')[Math.floor(r() * 3)] : cars[Math.floor(r() * cars.length)];
      // 出发位置跟着时刻走：同一时刻打开页面的人看到的车在同一处
      const len = this.laneLen[lane].at(-1)!;
      const t = ((Date.now() / 1000) * 4 * PPM + r() * len * 2) % (len * 2);
      this.cars.push({ img: this.image('vehicles'), id: v.id, paint: Math.floor(r() * v.paints.length), lane, s: t < len ? t : len * 2 - t, sdir: t < len ? 1 : -1, wait: 0, anim: 0, x: 0, y: 0, dir: 0 });
    }
  }

  setView(v: View): void {
    this.view = v;
  }

  setShade(c: number): void {
    this.shade = c;
    for (const img of this.images()) img.setTint(c);
  }

  /** 夜里：鸟回树上，猫睡觉，狗趴着 */
  setNight(on: boolean): void {
    this.night = on;
  }

  /** 下雨下雪：猫躲回屋檐下 */
  setWet(on: boolean): void {
    this.wet = on;
  }

  private *images(): Generator<Phaser.GameObjects.Image> {
    for (const f of this.flocks) for (const b of f.birds) yield b.img;
    for (const c of this.cats) yield c.img;
    for (const d of this.dogs) yield d.mob.img;
    for (const c of this.cars) yield c.img;
  }

  /** 每帧调用。x0..y1 是视野（世界像素），people 是看得见的人 */
  update(dt: number, x0: number, y0: number, x1: number, y1: number, people: Person[]): void {
    const pad = 160;
    const seen = (x: number, y: number) => x > x0 - pad && x < x1 + pad && y > y0 - pad && y < y1 + pad;
    const me = people.find((p) => p.self);
    this.stillFor = me && !me.moving ? this.stillFor + dt : 0;
    for (const f of this.flocks) {
      // 麻雀夜里不出来
      const on = !(this.night && f.species === 'sparrow') && f.birds.some((b) => seen(b.x, b.y));
      for (const b of f.birds) b.img.setVisible(on);
      if (on) this.updateFlock(f, dt, people);
    }
    for (const c of this.cats) {
      const on = seen(c.x, c.y);
      c.img.setVisible(on);
      if (on) this.updateCat(c, dt, me);
    }
    for (const d of this.dogs) {
      this.updateDog(d, dt);
      d.mob.img.setVisible(seen(d.mob.x, d.mob.y));
      if (d.mob.img.visible) this.draw(d.mob);
    }
    for (const c of this.cars) {
      this.updateCar(c, dt, people);
      const on = seen(c.x, c.y);
      c.img.setVisible(on);
      if (on) {
        const p = this.world.toView(c.x, c.y);
        const frame = c.wait > 0 ? 0 : Math.floor(c.anim * 6) % 2;
        c.img.setFrame(vehicleKey(c.id, c.paint, dirToView(this.view, c.dir), frame)).setPosition(Math.round(p.x), Math.round(p.y)).setDepth(p.y);
      }
    }
    if (this.heart) {
      const p = this.world.toView(this.heart.cat.x, this.heart.cat.y);
      this.heart.img.setPosition(Math.round(p.x), Math.round(p.y - 18 - (1 - (this.heart.until - this.scene.time.now) / 1500) * 6));
      if (this.scene.time.now > this.heart.until) {
        this.heart.img.destroy();
        this.heart = undefined;
      }
    }
    this.petCooldown -= dt;
  }

  // ---------- 鸟 ----------

  private updateFlock(f: Flock, dt: number, people: Person[]): void {
    const flying = f.birds.some((b) => b.state === 'fly');
    const scare = f.species === 'magpie' ? 4 * PPM : 3 * PPM;
    const spooked = !flying && f.birds.some((b) => b.alt < 2 && people.some((p) => Math.hypot(p.x - b.x, p.y - b.y) < scare));
    if (spooked || (this.night && f.species === 'magpie' && !flying && f.birds.some((b) => b.state !== 'perch'))) this.takeOff(f);
    for (const b of f.birds) {
      b.anim += dt;
      b.until -= dt;
      if (b.state === 'fly') {
        const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy);
        const step = b.speed * dt;
        if (d <= step) {
          b.x = b.tx;
          b.y = b.ty;
          b.alt = b.talt;
          b.state = b.talt > 0 ? 'perch' : 'stand';
          b.until = 6 + b.rand() * 20;
        } else {
          b.x += (dx / d) * step;
          b.y += (dy / d) * step;
          // 升到高处再落下：离终点越近越接近目标高度
          b.alt += ((d > 6 * PPM ? Math.max(b.talt, 40) : b.talt) - b.alt) * Math.min(1, dt * 3);
          b.dir = dirOf(dx, dy, b.dir);
        }
      } else if (b.state === 'hop') {
        const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy);
        if (d < 1 || b.until <= 0) (b.state = 'stand'), (b.until = 1 + b.rand() * 4);
        else (b.x += (dx / d) * b.speed * dt), (b.y += (dy / d) * b.speed * dt);
      } else if (b.state === 'perch') {
        // 栖了一阵飞回树下（夜里不下来）
        if (b.until <= 0 && !this.night && f.tree) {
          const p = this.near(f.tree.x, f.tree.y, 5 * PPM, b.rand);
          if (p) this.fly(b, p.x, p.y, 0);
          else b.until = 10;
        }
      } else if (b.until <= 0) {
        // 站一会儿，跳两步，换个方向
        const p = this.near(b.x, b.y, 1.5 * PPM, b.rand);
        if (p && b.rand() < 0.7) {
          b.state = 'hop';
          b.tx = p.x;
          b.ty = p.y;
          b.speed = (f.species === 'magpie' ? 1.4 : 1.8) * PPM;
          b.dir = dirOf(p.x - b.x, p.y - b.y, b.dir);
          b.until = 2;
        } else {
          b.dir = Math.floor(b.rand() * 4);
          b.until = 1 + b.rand() * 3;
        }
      }
      this.draw(b);
    }
  }

  /** 整群飞走：喜鹊飞到另一棵树（多半落在树冠上），麻雀飞到十几米外的地上 */
  private takeOff(f: Flock): void {
    const r = f.birds[0]?.rand;
    if (!r) return;
    const from = f.birds[0];
    if (f.species === 'magpie') {
      let tree = f.tree;
      for (let k = 0; k < 30; k++) {
        const t = this.world.trees[Math.floor(r() * this.world.trees.length)];
        const d = Math.hypot(t.x - from.x, t.y - from.y);
        if (d > 15 * PPM && d < 60 * PPM) {
          tree = t;
          break;
        }
      }
      if (!tree) return;
      f.tree = tree;
      const perch = this.night || r() < 0.6;
      for (const b of f.birds) {
        if (perch) {
          const h = tree.h * PPM;
          this.fly(b, tree.x + (b.rand() - 0.5) * h * 0.8, tree.y, h + (b.rand() - 0.3) * h * 0.4);
          b.perchY = tree.y;
        } else {
          const p = this.near(tree.x, tree.y, 5 * PPM, b.rand);
          if (p) this.fly(b, p.x, p.y, 0);
        }
      }
    } else {
      const a = r() * Math.PI * 2;
      const cx = from.x + Math.cos(a) * 16 * PPM, cy = from.y + Math.sin(a) * 16 * PPM;
      for (const b of f.birds) {
        const p = this.near(cx, cy, 3 * PPM, b.rand) ?? { x: b.x, y: b.y };
        this.fly(b, p.x, p.y, 0);
      }
    }
  }

  private fly(b: Mob, x: number, y: number, alt: number): void {
    b.state = 'fly';
    b.tx = x;
    b.ty = y;
    b.talt = alt;
    b.speed = (7 + b.rand() * 3) * PPM;
    if (!alt) b.perchY = undefined;
  }

  // ---------- 猫 ----------

  private updateCat(c: Mob, dt: number, me: Person | undefined): void {
    c.anim += dt;
    c.until -= dt;
    const home = this.night || this.wet;
    // 摸猫：自己站在猫旁边不动一会儿
    if (me && this.petCooldown <= 0 && this.stillFor > 0.6 && Math.hypot(me.x - c.x, me.y - c.y) < 2 * PPM) {
      this.petCooldown = 6;
      c.state = 'sit';
      c.until = 5;
      c.dir = dirOf(me.x - c.x, me.y - c.y, c.dir);
      this.heart?.img.destroy();
      const img = this.scene.add.image(0, 0, 'emotes', 2).setDepth(SKY_DEPTH);
      this.layer.add(img);
      this.heart = { img, cat: c, until: this.scene.time.now + 1500 };
    }
    if (c.state === 'walk') {
      const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
      if (d < 1) (c.state = 'sit'), (c.until = 6 + c.rand() * 20);
      else {
        const step = Math.min(d, c.speed * dt);
        const nx = c.x + (dx / d) * step, ny = c.y + (dy / d) * step;
        if (!this.free(nx, ny)) (c.state = 'sit'), (c.until = 3);
        else (c.x = nx), (c.y = ny), (c.dir = dirOf(dx, dy, c.dir));
      }
    } else if (c.until <= 0) {
      if (home) {
        // 回家：离家远就走回去，到了就睡（下雨天坐着）
        if (Math.hypot(c.hx - c.x, c.hy - c.y) > PPM) this.walkTo(c, c.hx, c.hy, 1.2);
        else (c.state = this.night ? 'sleep' : 'sit'), (c.until = 20);
      } else if (c.rand() < 0.55) {
        const p = this.near(c.hx, c.hy, 8 * PPM, c.rand);
        if (p) this.walkTo(c, p.x, p.y, 0.8);
        else c.until = 5;
      } else {
        // 晒太阳：坐着或者趴着睡
        c.state = c.rand() < 0.4 ? 'sleep' : 'sit';
        c.until = 10 + c.rand() * 30;
        if (c.state === 'sit') c.dir = Math.floor(c.rand() * 4);
      }
    }
    this.draw(c);
  }

  private walkTo(m: Mob, x: number, y: number, speed: number): void {
    m.state = 'walk';
    m.tx = x;
    m.ty = y;
    m.speed = speed * PPM;
  }

  // ---------- 狗 ----------

  private updateDog(d: { mob: Mob; lane: number; s: number; sdir: 1 | -1 }, dt: number): void {
    const m = d.mob;
    m.anim += dt;
    m.until -= dt;
    const len = this.laneLen[d.lane].at(-1)!;
    if (this.night) m.state = 'lie';
    else if (m.state === 'walk') {
      d.s += d.sdir * 1.1 * PPM * dt;
      if (d.s < 0 || d.s > len) {
        d.s = Math.max(0, Math.min(len, d.s));
        d.sdir = d.sdir === 1 ? -1 : 1;
        m.state = 'sit';
        m.until = 4 + m.rand() * 6;
      } else if (m.until <= -20 && m.rand() < dt * 0.05) (m.state = 'sit'), (m.until = 3 + m.rand() * 5);
    } else if (m.until <= 0) (m.state = 'walk'), (m.until = 0);
    // 走在路的右手边，离中心线 3.5 m
    const at = this.along(d.lane, d.s, d.sdir, 3.5 * PPM);
    m.x = at.x;
    m.y = at.y;
    if (m.state === 'walk') m.dir = at.dir;
  }

  // ---------- 车 ----------

  /** 车道上走过 s 像素处：右手边偏 off 像素的位置和行驶朝向 */
  private along(lane: number, s: number, sdir: 1 | -1, off: number): { x: number; y: number; dir: number } {
    const l = this.world.lanes[lane], acc = this.laneLen[lane];
    let i = 1;
    while (i < l.length - 1 && acc[i] < s) i++;
    const a = l[i - 1], b = l[i];
    const seg = acc[i] - acc[i - 1] || 1;
    const t = Math.max(0, Math.min(1, (s - acc[i - 1]) / seg));
    const dx = ((b.x - a.x) / seg) * sdir, dy = ((b.y - a.y) / seg) * sdir;
    return { x: a.x + (b.x - a.x) * t - dy * off, y: a.y + (b.y - a.y) * t + dx * off, dir: dirOf(dx, dy, DIR.down) };
  }

  private updateCar(c: Car, dt: number, people: Person[]): void {
    const len = this.laneLen[c.lane].at(-1)!;
    const at = this.along(c.lane, c.s, c.sdir, 1.6 * PPM);
    c.x = at.x;
    c.y = at.y;
    c.dir = at.dir;
    if (c.wait > 0) {
      c.wait -= dt;
      return;
    }
    // 前方 7 m、左右 2 m 内有人就停下等
    const ahead = this.along(c.lane, Math.min(len, Math.max(0, c.s + c.sdir * PPM)), c.sdir, 1.6 * PPM);
    const fx = ahead.x - c.x, fy = ahead.y - c.y, fl = Math.hypot(fx, fy) || 1;
    const blocked = people.some((p) => {
      const rx = p.x - c.x, ry = p.y - c.y;
      const along = (rx * fx + ry * fy) / fl, side = Math.abs(rx * fy - ry * fx) / fl;
      return along > -PPM && along < 7 * PPM && side < 2 * PPM;
    });
    if (blocked) return;
    c.anim += dt;
    c.s += c.sdir * 4 * PPM * dt;
    // 开到头掉头，停几秒
    if (c.s < 0 || c.s > len) {
      c.s = Math.max(0, Math.min(len, c.s));
      c.sdir = c.sdir === 1 ? -1 : 1;
      c.wait = 3;
    }
  }

  // ---------- 画 ----------

  private draw(m: Mob): void {
    const states = FRAMES[m.species];
    const state = states[m.state] ? m.state : Object.keys(states)[0];
    const n = states[state];
    const fps = state === 'fly' ? 10 : state === 'sleep' || state === 'sit' || state === 'lie' || state === 'stand' || state === 'perch' ? 1.5 : 8;
    const frame = Math.floor(m.anim * fps) % n;
    const p = this.world.toView(m.x, m.y);
    const depth = m.state === 'fly' ? SKY_DEPTH : m.perchY !== undefined && m.alt > 0 ? this.world.toView(m.x, m.perchY).y + 1 : p.y;
    m.img
      .setFrame(faunaKey(m.species, m.variant, state, dirToView(this.view, m.dir), frame))
      .setPosition(Math.round(p.x), Math.round(p.y - m.alt))
      .setDepth(depth);
  }

  destroy(): void {
    for (const img of this.images()) img.destroy();
    this.heart?.img.destroy();
  }
}
