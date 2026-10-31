// 校园场景：地图、建筑与物件、角色移动、名字与气泡。
// 两台相机：主相机按整数倍放大画世界（像素保持方正），界面相机不缩放，只画名字和短语气泡（文字清晰）。
import Phaser from 'phaser';
import { DIR, PHRASES, cleanLook, type Look } from '../shared/social.ts';
import type { Player } from '../shared/state.ts';
import { LAYER, TILE, WALK_SPEED, Walkable, prop, type TiledMap, type TiledObject } from '../shared/world.ts';
import { Avatar, GHOST_DEPTH } from './avatar.ts';
import type { Net, NetHandlers } from './net.ts';

export const PIXEL_FONT = '"Fusion Pixel", "PingFang SC", "Microsoft YaHei", sans-serif';

export interface Poi {
  name: string;
  text: string;
  src: string;
  x: number;
  y: number;
  r: number;
}

/** 场景通知界面层的事件 */
export interface SceneHooks {
  poi(p: Poi | null): void;
  count(n: number): void;
  left(code: number): void;
}

/** 只给附近的人显示名字，人多时只显示最近的几个 */
const LABEL_RANGE = 10 * TILE;
const LABEL_MAX = 12;
const BUBBLE_MS = 3500;
/** 名字、气泡离脚底的高度（世界像素） */
const LABEL_LIFT = 27;
/** 顶到障碍时，最多往旁边找几像素的空位绕过去（够绕开三格宽的校训石） */
const NUDGE = 2 * TILE;

interface Actor {
  av: Avatar;
  name: string;
  label: Phaser.GameObjects.Text;
  /** 远端玩家的目标位置（本地玩家不用） */
  tx: number;
  ty: number;
  emote?: { img: Phaser.GameObjects.Image; until: number };
  say?: { text: Phaser.GameObjects.Text; until: number };
}

export class CampusScene extends Phaser.Scene {
  private readonly mapData: TiledMap;
  private readonly hooks: SceneHooks;
  private readonly walk: Walkable;
  private worldLayer!: Phaser.GameObjects.Layer;
  private uiLayer!: Phaser.GameObjects.Layer;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private cam = { x: 0, y: 0 };
  private net?: Net;
  private me?: Actor & { id: string };
  private readonly others = new Map<string, Actor>();
  private pois: Poi[] = [];
  private poiNow: Poi | null = null;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  /** 点击行走的剩余路线（脚底坐标），按键移动时清空 */
  private route: { x: number; y: number }[] = [];

  constructor(map: TiledMap, hooks: SceneHooks) {
    super('campus');
    this.mapData = map;
    this.hooks = hooks;
    this.walk = new Walkable(map);
  }

  private objects(type?: string): TiledObject[] {
    const l = this.mapData.layers.find((x) => x.name === LAYER.objects);
    const all = l?.type === 'objectgroup' ? l.objects : [];
    return type ? all.filter((o) => o.type === type) : all;
  }

  preload(): void {
    this.load.tilemapTiledJSON('map', this.mapData as unknown as object);
    this.load.image('tiles', 'tiles.png');
    this.load.spritesheet('avatar', 'avatar.png', { frameWidth: 16, frameHeight: 24 });
    this.load.spritesheet('emotes', 'emotes.png', { frameWidth: 18, frameHeight: 18 });
    this.load.image('props', 'props.png');
    this.load.json('props-meta', 'props.json');
    for (const o of this.objects('building')) this.load.image(prop(o, 'sprite', ''), `buildings/${prop(o, 'sprite', '')}.png`);
  }

  create(): void {
    this.worldLayer = this.add.layer();
    this.uiLayer = this.add.layer();
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height).setName('ui');
    this.cameras.main.ignore(this.uiLayer);
    this.uiCam.ignore(this.worldLayer);

    const g = this.add.graphics();
    g.fillStyle(0x1d2a3a, 0.35).fillEllipse(6, 2, 12, 4).generateTexture('foot-shadow', 12, 4).destroy();

    this.buildGround();
    this.buildBuildings();
    this.buildProps();
    this.pois = this.objects('poi').map((o) => ({
      name: o.name,
      text: prop(o, 'text', ''),
      src: prop(o, 'src', ''),
      x: o.x,
      y: o.y,
      r: prop(o, 'radius', 4 * TILE),
    }));

    const kb = this.input.keyboard!;
    // 字母键不拦截默认行为，否则输入框里打不了 WASD
    const arrows = kb.addKeys({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' }) as Record<string, Phaser.Input.Keyboard.Key>;
    const letters = kb.addKeys('W,A,S,D', false) as Record<string, Phaser.Input.Keyboard.Key>;
    this.keys = { up: arrows.up, down: arrows.down, left: arrows.left, right: arrows.right, w: letters.W, a: letters.A, s: letters.S, d: letters.D };
    // 点击或触摸地面：走过去
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.me) return;
      const w = this.screenToWorld(p.x, p.y);
      this.route = this.walk.path(this.me.av.x, this.me.av.y, w.x, w.y);
    });

    // 加入前，镜头停在北门内，看向信息学馆
    const spawn = this.objects('spawn')[0];
    this.cam = { x: spawn.x, y: spawn.y - 140 };
    this.applyZoom();
    this.scale.on('resize', () => this.applyZoom());
  }

  /** 交给 Net.join 的回调：服务端状态变化 → 场景 */
  readonly handlers: NetHandlers = {
    add: (id, p, self) => this.addActor(id, p, self),
    change: (id, p) => {
      const a = this.others.get(id);
      if (!a) return;
      a.tx = p.x;
      a.ty = p.y;
      a.av.dir = p.dir;
      a.av.moving = p.moving;
    },
    remove: (id) => {
      const a = this.others.get(id);
      if (!a) return;
      this.destroyActor(a);
      this.others.delete(id);
      this.hooks.count(this.others.size + 1);
    },
    emote: (id, emote) => this.showEmote(id, emote),
    say: (id, phrase) => this.showSay(id, phrase),
    snap: (x, y) => {
      if (!this.me) return;
      this.me.av.place(x, y);
      this.net?.resetLast(x, y);
      this.route = [];
    },
    left: (code) => this.hooks.left(code),
  };

  attach(net: Net): void {
    this.net = net;
  }

  /** 小地图用：所有人的位置 */
  dots(): { x: number; y: number; self: boolean }[] {
    const out = [...this.others.values()].map((a) => ({ x: a.av.x, y: a.av.y, self: false }));
    if (this.me) out.push({ x: this.me.av.x, y: this.me.av.y, self: true });
    return out;
  }

  get mapSize(): { w: number; h: number } {
    return { w: this.mapData.width, h: this.mapData.height };
  }

  update(_t: number, dtMs: number): void {
    const dt = Math.min(dtMs, 100) / 1000;
    if (this.me) this.moveMe(dt);
    for (const a of this.others.values()) this.moveRemote(a, dt);
    this.followCamera(dt);
    this.updateOverlays();
    this.checkPoi();
  }

  // ---------- 世界 ----------

  private buildGround(): void {
    const map = this.make.tilemap({ key: 'map' });
    const ts = map.addTilesetImage('tiles', 'tiles')!;
    for (const [i, name] of [LAYER.ground, LAYER.edges].entries()) {
      const layer = map.createLayer(name, ts, 0, 0)!;
      layer.setDepth(-10 + i);
      this.worldLayer.add(layer);
    }
  }

  /**
   * 建筑按列切成几段，每段的深度取这一列占地最靠前（屏幕最下）的那一排：
   * U 形楼的院子里，人会正确地站在后楼前面、前楼后面
   */
  private buildBuildings(): void {
    for (const o of this.objects('building')) {
      const key = prop(o, 'sprite', '');
      const top = prop(o, 'top', 0);
      const rows = prop(o, 'mask', '').split('/');
      const tex = this.textures.get(key).getSourceImage() as HTMLImageElement;
      const base = [...rows[0]].map((_, c) => {
        for (let r = rows.length - 1; r >= 0; r--) if (rows[r][c] !== '0') return r;
        return -1;
      });
      let c0 = 0;
      for (let c = 1; c <= base.length; c++) {
        if (c < base.length && base[c] === base[c0]) continue;
        const last = c === base.length;
        const w = last ? tex.width - c0 * TILE : (c - c0) * TILE;
        const img = this.add.image(o.x, o.y - top, key).setOrigin(0, 0).setCrop(c0 * TILE, 0, w, tex.height);
        img.setDepth(base[c0] >= 0 ? o.y + (base[c0] + 1) * TILE : 0);
        this.worldLayer.add(img);
        c0 = c;
      }
    }
  }

  private buildProps(): void {
    const meta = this.cache.json.get('props-meta') as Record<string, { x: number; y: number; w: number; h: number; ax: number; ay: number }>;
    const tex = this.textures.get('props');
    for (const [name, m] of Object.entries(meta)) tex.add(name, 0, m.x, m.y, m.w, m.h);
    for (const o of this.objects('prop')) {
      const m = meta[prop(o, 'sprite', '')];
      if (!m) continue;
      const img = this.add.image(o.x, o.y, 'props', prop(o, 'sprite', '')).setOrigin(m.ax / m.w, m.ay / m.h).setDepth(o.y);
      this.worldLayer.add(img);
    }
  }

  // ---------- 角色 ----------

  private label(name: string, self: boolean): Phaser.GameObjects.Text {
    const t = this.add
      .text(0, 0, name, { fontFamily: PIXEL_FONT, fontSize: '12px', color: self ? '#f0c94a' : '#ffffff', stroke: '#2a2433', strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setResolution(window.devicePixelRatio || 1);
    this.uiLayer.add(t);
    return t;
  }

  private addActor(id: string, p: Player, self: boolean): void {
    const look: Look = cleanLook(p);
    const av = new Avatar(this, this.worldLayer, look, p.x, p.y, self);
    av.dir = p.dir;
    const actor: Actor = { av, name: p.name, label: this.label(p.name, self), tx: p.x, ty: p.y };
    if (self) {
      this.me = { ...actor, id };
      this.cam = { x: p.x, y: p.y - 12 };
    } else this.others.set(id, actor);
    this.hooks.count(this.others.size + 1);
  }

  private destroyActor(a: Actor): void {
    a.av.destroy();
    a.label.destroy();
    a.emote?.img.destroy();
    a.say?.text.destroy();
  }

  private actor(id: string): Actor | undefined {
    return this.me?.id === id ? this.me : this.others.get(id);
  }

  private showEmote(id: string, emote: number): void {
    const a = this.actor(id);
    if (!a) return;
    a.emote?.img.destroy();
    const img = this.add.image(a.av.x, a.av.y - LABEL_LIFT, 'emotes', emote).setOrigin(0.5, 1).setDepth(GHOST_DEPTH + 1);
    this.worldLayer.add(img);
    a.emote = { img, until: this.time.now + BUBBLE_MS };
  }

  private showSay(id: string, phrase: number): void {
    const a = this.actor(id);
    if (!a || !PHRASES[phrase]) return;
    a.say?.text.destroy();
    const text = this.add
      .text(0, 0, PHRASES[phrase], { fontFamily: PIXEL_FONT, fontSize: '12px', color: '#2a2433', backgroundColor: '#ffffff', padding: { x: 4, y: 2 } })
      .setOrigin(0.5, 1)
      .setResolution(window.devicePixelRatio || 1);
    this.uiLayer.add(text);
    a.say = { text, until: this.time.now + BUBBLE_MS };
  }

  private moveMe(dt: number): void {
    const me = this.me!;
    const k = this.keys;
    const typing = document.activeElement instanceof HTMLInputElement;
    let vx = 0, vy = 0;
    if (!typing) {
      vx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
      vy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    }
    if (vx || vy) this.route = [];
    else {
      while (this.route.length && Math.hypot(this.route[0].x - me.av.x, this.route[0].y - me.av.y) < 2) this.route.shift();
      if (this.route.length) (vx = this.route[0].x - me.av.x), (vy = this.route[0].y - me.av.y);
    }
    const len = Math.hypot(vx, vy);
    let moved = false;
    if (len > 0) {
      // 沿路线走时最后一小步正好落在路点上，不来回抖
      const step = Math.min(WALK_SPEED * dt, this.route.length ? len : Infinity) / len;
      let { x, y } = me.av;
      // 分轴移动：贴着墙也能顺着滑过去
      if (!this.walk.footBlocked(x + vx * step, y)) (x += vx * step), (moved = true);
      if (!this.walk.footBlocked(x, y + vy * step)) (y += vy * step), (moved = true);
      // 正面顶到障碍边角时，往空的一侧挪一点，绕过去
      if (!moved && (!vx || !vy)) {
        const ax = vx ? 0 : 1, ay = vy ? 0 : 1;
        for (let d = 1; d <= NUDGE && !moved; d++)
          for (const s of [-1, 1]) {
            const sx = ax * s * step * len, sy = ay * s * step * len;
            if (!this.walk.footBlocked(x + ax * s * d + vx * step, y + ay * s * d + vy * step) && !this.walk.footBlocked(x + sx, y + sy)) {
              x += sx;
              y += sy;
              moved = true;
              break;
            }
          }
      }
      if (!moved) this.route = [];
      me.av.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? DIR.left : DIR.right) : vy < 0 ? DIR.up : DIR.down;
      me.av.place(x, y);
    }
    me.av.moving = moved;
    me.av.update(dt);
    this.net?.move(me.av.x, me.av.y, me.av.dir, moved);
  }

  private moveRemote(a: Actor, dt: number): void {
    const dx = a.tx - a.av.x, dy = a.ty - a.av.y;
    const d = Math.hypot(dx, dy);
    if (d > 6 * TILE) a.av.place(a.tx, a.ty);
    else if (d > 0.5) {
      const s = Math.min(d, WALK_SPEED * 1.3 * dt);
      a.av.place(a.av.x + (dx / d) * s, a.av.y + (dy / d) * s);
    }
    if (d > 1) a.av.moving = true;
    a.av.update(dt);
  }

  // ---------- 相机与覆盖层 ----------

  private applyZoom(): void {
    const { width, height } = this.scale;
    // 整数倍放大：桌面 1080p 约 3 倍，手机约 2 倍
    const zoom = Phaser.Math.Clamp(Math.floor(Math.min(width, height) / 320), 2, 5);
    this.cameras.main.setZoom(zoom);
    this.cameras.main.setBounds(0, 0, this.mapData.width * TILE, this.mapData.height * TILE);
    this.uiCam.setSize(width, height);
  }

  private followCamera(dt: number): void {
    const cam = this.cameras.main;
    if (this.me) {
      const k = 1 - Math.pow(0.0001, dt);
      this.cam.x += (this.me.av.x - this.cam.x) * k;
      this.cam.y += (this.me.av.y - 12 - this.cam.y) * k;
    }
    // 镜头不出地图
    const hw = cam.width / cam.zoom / 2, hh = cam.height / cam.zoom / 2;
    const W = this.mapData.width * TILE, H = this.mapData.height * TILE;
    this.cam.x = Phaser.Math.Clamp(this.cam.x, hw, W - hw);
    this.cam.y = Phaser.Math.Clamp(this.cam.y, hh, H - hh);
    // 对齐到屏幕像素，避免像素抖动
    const z = cam.zoom;
    cam.centerOn(Math.round(this.cam.x * z) / z, Math.round(this.cam.y * z) / z);
  }

  private worldToScreen(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return { x: Math.round((x - cam.midPoint.x) * cam.zoom + cam.width / 2), y: Math.round((y - cam.midPoint.y) * cam.zoom + cam.height / 2) };
  }

  private screenToWorld(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return { x: (x - cam.width / 2) / cam.zoom + cam.midPoint.x, y: (y - cam.height / 2) / cam.zoom + cam.midPoint.y };
  }

  private updateOverlays(): void {
    const now = this.time.now;
    const me = this.me;
    const all: Actor[] = [...this.others.values()];
    // 名字：自己总显示；别人按距离取最近的几个
    const near = new Set(
      me
        ? all
            .map((a) => ({ a, d: Math.hypot(a.av.x - me.av.x, a.av.y - me.av.y) }))
            .filter((x) => x.d < LABEL_RANGE)
            .sort((p, q) => p.d - q.d)
            .slice(0, LABEL_MAX)
            .map((x) => x.a)
        : [],
    );
    if (me) all.push(me), near.add(me);
    const zoom = this.cameras.main.zoom;
    // 每个人头顶从下往上叠：名字、表情、短语。人挤在一起时，靠后（屏幕上方）的人整摞往上让，互不遮挡
    const stacks = all
      .map((a) => {
        if (a.emote && now > a.emote.until) a.emote.img.destroy(), (a.emote = undefined);
        if (a.say && now > a.say.until) a.say.text.destroy(), (a.say = undefined);
        a.label.setVisible(near.has(a));
        const parts: { h: number; w: number; place: (x: number, bottom: number) => void }[] = [];
        if (a.label.visible) parts.push({ h: a.label.height - 2, w: a.label.width, place: (x, b) => a.label.setPosition(x, b) });
        if (a.emote) {
          const img = a.emote.img;
          parts.push({ h: img.height * zoom + 2, w: img.width * zoom, place: (x, b) => img.setPosition(this.screenToWorld(x, b).x, this.screenToWorld(x, b).y) });
        }
        if (a.say) {
          const t = a.say.text;
          parts.push({ h: t.height + 2, w: t.width, place: (x, b) => t.setPosition(x, b) });
        }
        const s = this.worldToScreen(a.av.x, a.av.y - LABEL_LIFT);
        const h = parts.reduce((n, p) => n + p.h, 0);
        const w = Math.max(0, ...parts.map((p) => p.w));
        return { parts, x: s.x, bottom: s.y, h, w };
      })
      .filter((st) => st.parts.length)
      .sort((p, q) => q.bottom - p.bottom);
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    for (const st of stacks) {
      const l = st.x - st.w / 2, r = st.x + st.w / 2;
      for (let moved = true; moved; ) {
        moved = false;
        for (const p of placed)
          if (l < p.r && r > p.l && st.bottom - st.h < p.b && st.bottom > p.t) {
            st.bottom = p.t - 1;
            moved = true;
          }
      }
      placed.push({ l, r, t: st.bottom - st.h, b: st.bottom });
      let b = st.bottom;
      for (const part of st.parts) part.place(st.x, b), (b -= part.h);
    }
  }

  private checkPoi(): void {
    let best: Poi | null = null;
    if (this.me) {
      let bd = Infinity;
      for (const p of this.pois) {
        const d = Math.hypot(p.x - this.me.av.x, p.y - this.me.av.y);
        if (d < p.r && d < bd) (bd = d), (best = p);
      }
    }
    if (best !== this.poiNow) {
      this.poiNow = best;
      this.hooks.poi(best);
    }
  }
}
