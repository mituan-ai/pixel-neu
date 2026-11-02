// 校园场景：地图、建筑与物件、角色移动、名字与气泡。
// 两台相机：主相机按整数倍放大画世界（像素保持方正），界面相机不缩放，只画名字和短语气泡（文字清晰）。
// 四个视角：角色、寻路、碰撞、网络都用世界坐标；只有画到屏幕上时换算成当前视角的坐标（shared/view.ts）。
// 切换视角时地面、建筑、物件整套重建，角色重新摆位。
import Phaser from 'phaser';
import { AVATAR, DIR, PHRASES, cleanLook, type Look } from '../shared/social.ts';
import type { Player } from '../shared/state.ts';
import { VIEW_NAME, dirFromView, dirToView, fromView, toView, viewSize, type View } from '../shared/view.ts';
import { DEV_BOOST, GROUND_CHUNK, LAYER, TILE, WALK_SPEED, Walkable, prop, type TiledMap, type TiledObject } from '../shared/world.ts';
import { Avatar, GHOST_DEPTH, display } from './avatar.ts';
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
const LABEL_RANGE = 20 * TILE;
const LABEL_MAX = 12;
const BUBBLE_MS = 3500;
/** 名字、气泡离脚底的高度（世界像素） */
const LABEL_LIFT = 27;
/** 顶到障碍时，最多往旁边找几像素的空位绕过去（够绕开 6 m 宽的校训石） */
const NUDGE = 4 * TILE;
/** 缩放只用整数倍（像素保持方正）：1 倍看得远，4 倍看细节 */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
const ZOOM_KEY = 'pixel-neu-zoom';
/** 滚轮连续滚动时，两次缩放至少隔这么久（毫秒），触控板一划不会直接跳到头 */
const WHEEL_GAP = 160;
/** 静态物件按这么大的方块（屏幕像素）判断在不在视野附近；物件一多，留在显示列表里的每帧都要排序、遍历 */
const CHUNK = 512;

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
  /** 地面、建筑、物件：切换视角时整套销毁重建 */
  private scenery: Phaser.GameObjects.GameObject[] = [];
  /** 有包围盒的静态物件：只有相机附近的才放进显示列表 */
  private culled: { o: Phaser.GameObjects.GameObject; x0: number; y0: number; x1: number; y1: number; on: boolean }[] = [];
  /** 上次剔除时相机所在的方块范围，没变就不重算 */
  private cullAt = '';
  private view: View = 0;
  /** 已经摆出来的地面分块（键是「列-行」），换视角时清空重摆；纹理按视野加载和卸载 */
  private groundImgs = new Map<string, Phaser.GameObjects.Image>();
  private groundAt = '';
  /** 已经交给加载器、还没加载完的地面块 */
  private groundLoading = new Set<string>();
  /** 视角变了通知界面（小地图跟着转） */
  onView?: (v: View) => void;
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
  private shift!: Phaser.Input.Keyboard.Key;
  /** 玩家用滚轮或按钮选的缩放倍数；null 时按屏幕大小取默认 */
  private userZoom: number | null = loadZoom();
  private lastWheel = 0;
  /** 点击行走的终点标记；ghost 是被楼挡住时透出来的半透明那份 */
  private dest!: Phaser.GameObjects.Image;
  private destGhost!: Phaser.GameObjects.Image;
  /** 缩放倍数变了：界面显示当前倍数 */
  onZoom?: (zoom: number) => void;

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
    this.load.spritesheet('avatar', 'avatar.png', { frameWidth: AVATAR.w, frameHeight: AVATAR.h });
    this.load.spritesheet('emotes', 'emotes.png', { frameWidth: 18, frameHeight: 18 });
    this.load.image('props', 'props.png');
    this.load.json('props-meta', 'props.json');
    for (const o of this.objects('building'))
      for (const v of VIEW_NAME) this.load.image(`${prop(o, 'sprite', '')}-${v}`, `buildings/${prop(o, 'sprite', '')}-${v}.png`);
  }

  create(): void {
    this.worldLayer = this.add.layer();
    this.uiLayer = this.add.layer();
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height).setName('ui');
    this.cameras.main.ignore(this.uiLayer);
    this.uiCam.ignore(this.worldLayer);

    const g = this.add.graphics();
    g.fillStyle(0x1d2a3a, 0.35).fillEllipse(6, 2, 12, 4).generateTexture('foot-shadow', 12, 4).destroy();
    // 终点标记：金色像素环
    const ring = this.add.graphics().fillStyle(0x2a2433).fillRect(3, 0, 8, 1).fillRect(3, 6, 8, 1).fillRect(0, 2, 1, 3).fillRect(13, 2, 1, 3);
    ring.fillRect(1, 1, 2, 1).fillRect(11, 1, 2, 1).fillRect(1, 5, 2, 1).fillRect(11, 5, 2, 1);
    ring.fillStyle(0xf0c94a).fillRect(3, 1, 8, 1).fillRect(3, 5, 8, 1).fillRect(1, 2, 2, 3).fillRect(11, 2, 2, 3);
    ring.generateTexture('dest', 14, 7).destroy();
    this.dest = this.add.image(0, 0, 'dest').setDepth(-4).setVisible(false);
    this.destGhost = this.add.image(0, 0, 'dest').setDepth(GHOST_DEPTH).setAlpha(0.45).setVisible(false);
    this.worldLayer.add([this.dest, this.destGhost]);
    this.tweens.add({ targets: this.dest, scale: 1.25, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const meta = this.cache.json.get('props-meta') as Record<string, { x: number; y: number; w: number; h: number }>;
    const tex = this.textures.get('props');
    for (const [name, m] of Object.entries(meta)) tex.add(name, 0, m.x, m.y, m.w, m.h);
    this.buildScenery();
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
    this.shift = kb.addKey('SHIFT', false);
    // 点击或触摸地面：走过去
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.me) return;
      const s = this.screenToView(p.x, p.y);
      const w = this.fromView(s.x, s.y);
      this.walkTo(w.x, w.y);
    });
    // 滚轮缩放
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      if (!dy || this.time.now - this.lastWheel < WHEEL_GAP) return;
      this.lastWheel = this.time.now;
      this.zoomBy(dy < 0 ? 1 : -1);
    });
    // Q、E 转视角（字母键不拦截，输入框里照常打字）
    kb.on('keydown-Q', () => this.rotate(-1));
    kb.on('keydown-E', () => this.rotate(1));

    // 角色按当前视角换算显示位置和朝向
    display.at = (x, y) => this.toView(x, y);
    display.dir = (d) => dirToView(this.view, d);

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

  /** 全图用：地标的名字和位置 */
  get landmarks(): { name: string; x: number; y: number }[] {
    return this.pois.map((p) => ({ name: p.name, x: p.x, y: p.y }));
  }

  /** 走到世界坐标 (x, y)：寻路后沿路线走，走不到返回 false */
  walkTo(x: number, y: number): boolean {
    if (!this.me) return false;
    this.route = this.walk.path(this.me.av.x, this.me.av.y, x, y);
    return this.route.length > 0;
  }

  /** 点击行走的终点（世界坐标），没在走时为 null */
  destination(): { x: number; y: number } | null {
    return this.route[this.route.length - 1] ?? null;
  }

  get zoom(): number {
    return this.cameras.main.zoom;
  }

  /** 缩放：+1 放大一倍、-1 缩小一倍，限在 ZOOM_MIN–ZOOM_MAX */
  zoomBy(step: number): void {
    const z = Phaser.Math.Clamp(this.cameras.main.zoom + step, ZOOM_MIN, ZOOM_MAX);
    if (z === this.cameras.main.zoom) return;
    this.userZoom = z;
    try {
      localStorage.setItem(ZOOM_KEY, String(z));
    } catch {
      /* 存不了下次就用默认倍数 */
    }
    this.applyZoom();
    this.onZoom?.(z);
  }

  get mapSize(): { w: number; h: number } {
    return { w: this.mapData.width, h: this.mapData.height };
  }

  /** 转视角：+1 顺时针（屏幕上方从北转到东），-1 逆时针 */
  rotate(step: number): void {
    if (document.activeElement instanceof HTMLInputElement) return;
    // 镜头中心换算到新视角，画面围绕镜头中心转
    const center = this.fromView(this.cam.x, this.cam.y);
    this.view = ((this.view + step + 4) % 4) as View;
    this.buildScenery();
    this.cam = this.toView(center.x, center.y);
    for (const a of this.actors()) a.av.redraw();
    this.applyZoom();
    this.onView?.(this.view);
  }

  private get worldPx(): { w: number; h: number } {
    return { w: this.mapData.width * TILE, h: this.mapData.height * TILE };
  }
  private toView(x: number, y: number): { x: number; y: number } {
    return toView(this.view, this.worldPx.w, this.worldPx.h, x, y);
  }
  private fromView(x: number, y: number): { x: number; y: number } {
    return fromView(this.view, this.worldPx.w, this.worldPx.h, x, y);
  }
  private actors(): Actor[] {
    return this.me ? [...this.others.values(), this.me] : [...this.others.values()];
  }

  update(_t: number, dtMs: number): void {
    const dt = Math.min(dtMs, 100) / 1000;
    if (this.me) this.moveMe(dt);
    for (const a of this.others.values()) this.moveRemote(a, dt);
    this.followCamera(dt);
    this.cull();
    this.updateGround();
    this.placeDest();
    this.updateOverlays();
    this.checkPoi();
  }

  // ---------- 世界 ----------

  private buildScenery(): void {
    for (const o of this.scenery) o.destroy();
    this.scenery = [];
    this.culled = [];
    this.cullAt = '';
    for (const img of this.groundImgs.values()) img.destroy();
    this.groundImgs.clear();
    this.groundAt = '';
    this.buildBuildings();
    this.buildProps();
    this.buildFences();
  }

  /** 记下一个静态物件；给了包围盒的，交给 cull() 决定什么时候放进显示列表 */
  private keep<T extends Phaser.GameObjects.GameObject>(o: T, box?: Phaser.Geom.Rectangle): T {
    this.scenery.push(o);
    if (box) {
      // add.image 先放进了场景的显示列表，拿出来等 cull() 再放进世界层
      o.removeFromDisplayList();
      this.culled.push({ o, x0: box.x, y0: box.y, x1: box.right, y1: box.bottom, on: false });
    } else this.worldLayer.add(o);
    return o;
  }

  /** 相机跨过方块边界时，把视野外扩一块以内的静态物件放进显示列表，其余的拿出来 */
  private cull(): void {
    const v = this.cameras.main.worldView;
    const c0 = Math.floor(v.x / CHUNK) - 1, r0 = Math.floor(v.y / CHUNK) - 1;
    const c1 = Math.floor(v.right / CHUNK) + 2, r1 = Math.floor(v.bottom / CHUNK) + 2;
    const at = `${c0},${r0},${c1},${r1}`;
    if (at === this.cullAt) return;
    this.cullAt = at;
    for (const s of this.culled) {
      const on = s.x1 >= c0 * CHUNK && s.x0 <= c1 * CHUNK && s.y1 >= r0 * CHUNK && s.y0 <= r1 * CHUNK;
      if (on === s.on) continue;
      s.on = on;
      if (on) this.worldLayer.add(s.o);
      else this.worldLayer.remove(s.o);
    }
  }

  /**
   * 地面分块图（地图工具烘焙的 assets/ground/<列>-<行>.png）：视野外扩一块以内的加载并摆出来，
   * 外扩两块以外的卸掉纹理。分块按世界朝向画，换视角时整块转 90° 的倍数
   */
  private updateGround(): void {
    const v = this.cameras.main.worldView;
    const a = this.fromView(v.x, v.y), b = this.fromView(v.right, v.bottom);
    const box = (pad: number) => [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)].map((q, k) => Math.floor(q / GROUND_CHUNK) + (k < 2 ? -pad : pad));
    const [c0, r0, c1, r1] = box(1);
    const at = `${this.view},${c0},${r0},${c1},${r1}`;
    if (at === this.groundAt) return;
    this.groundAt = at;
    const { w, h } = this.worldPx;
    const want = new Set<string>();
    for (let r = Math.max(0, r0); r <= Math.min(r1, Math.ceil(h / GROUND_CHUNK) - 1); r++)
      for (let c = Math.max(0, c0); c <= Math.min(c1, Math.ceil(w / GROUND_CHUNK) - 1); c++) want.add(`${c}-${r}`);
    for (const k of want) {
      if (this.groundImgs.has(k)) continue;
      if (this.textures.exists(`g${k}`)) this.placeChunk(k);
      else if (!this.groundLoading.has(k)) {
        this.groundLoading.add(k);
        this.load.image(`g${k}`, `ground/${k}.png`);
        this.load.once(`filecomplete-image-g${k}`, () => {
          this.groundLoading.delete(k);
          this.placeChunk(k);
        });
      }
    }
    if (!this.load.isLoading()) this.load.start();
    // 卸掉离得远的
    const [d0, e0, d1, e1] = box(2);
    for (const [k, img] of this.groundImgs) {
      const [c, r] = k.split('-').map(Number);
      if (c >= d0 && c <= d1 && r >= e0 && r <= e1) continue;
      img.destroy();
      this.groundImgs.delete(k);
      this.textures.remove(`g${k}`);
    }
  }

  private placeChunk(k: string): void {
    if (this.groundImgs.has(k)) return;
    const [c, r] = k.split('-').map(Number);
    const src = this.textures.get(`g${k}`).getSourceImage();
    const p = this.toView(c * GROUND_CHUNK + src.width / 2, r * GROUND_CHUNK + src.height / 2);
    const img = this.add.image(p.x, p.y, `g${k}`).setAngle(-90 * this.view).setDepth(-10);
    this.worldLayer.add(img);
    this.groundImgs.set(k, img);
  }

  /**
   * 建筑按 16 像素一列切成几段，每段的深度取这一列楼基最靠前（屏幕最下）的那一行（地图里的 front）：
   * U 形楼的院子里，人会正确地站在后楼前面、前楼后面
   */
  private buildBuildings(): void {
    for (const o of this.objects('building')) {
      const key = `${prop(o, 'sprite', '')}-${VIEW_NAME[this.view]}`;
      const top = prop(o, 'top', 0);
      const fronts = Object.fromEntries(prop(o, 'front', '').split('|').map((f) => [f[0], f.slice(2).split(',').map(Number)]));
      const base: number[] = fronts[VIEW_NAME[this.view]];
      const a = this.toView(o.x, o.y), b = this.toView(o.x + o.width, o.y + o.height);
      const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
      const tex = this.textures.get(key).getSourceImage() as HTMLImageElement;
      let c0 = 0;
      for (let c = 1; c <= base.length; c++) {
        if (c < base.length && base[c] === base[c0]) continue;
        const last = c === base.length;
        const w = last ? tex.width - c0 * TILE : (c - c0) * TILE;
        const img = this.add.image(x0, y0 - top, key).setOrigin(0, 0).setCrop(c0 * TILE, 0, w, tex.height);
        img.setDepth(base[c0] >= 0 ? y0 + base[c0] + 1 : 0);
        this.keep(img, img.getBounds());
        c0 = c;
      }
    }
  }

  /** 物件：四个视角各一张的叫「名字@N」等；rot 是物件相对美术朝向转了几个 90°，换算出该用哪个视角的图 */
  private buildProps(): void {
    const meta = this.cache.json.get('props-meta') as Record<string, { w: number; h: number; ax: number; ay: number }>;
    for (const o of this.objects('prop')) {
      const name = prop(o, 'sprite', '');
      const frame = meta[name] ? name : `${name}@${VIEW_NAME[(this.view - prop(o, 'rot', 0) + 8) % 4]}`;
      const m = meta[frame];
      if (!m) continue;
      const p = this.toView(o.x, o.y);
      // 平铺在地上的（台阶）画在地面之上、一切站立物之下
      const img = this.add.image(p.x, p.y, 'props', frame).setOrigin(m.ax / m.w, m.ay / m.h).setDepth(prop(o, 'flat', false) ? -5 : p.y);
      this.keep(img, img.getBounds());
    }
  }

  /**
   * 校界铁栅栏（和北门两侧的栅栏同一样式）：沿折线每 2 m 切一段，每段一个 Graphics，
   * 深度取这一段在屏幕上最靠下的点，人走到栅栏前后都能正确遮挡
   */
  private buildFences(): void {
    const H = 13, STEP = TILE;
    for (const o of this.objects('fence')) {
      const pts = (o.polyline ?? []).map((q) => this.toView(o.x + q.x, o.y + q.y));
      for (let k = 1; k < pts.length; k++) {
        const [a, b] = [pts[k - 1], pts[k]];
        const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / STEP));
        for (let j = 0; j < n; j++) {
          const p = { x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n };
          const q = { x: a.x + ((b.x - a.x) * (j + 1)) / n, y: a.y + ((b.y - a.y) * (j + 1)) / n };
          const g = this.add.graphics();
          g.lineStyle(1, 0x1d2a3a, 0.3).lineBetween(p.x + 2, p.y + 1, q.x + 2, q.y + 1);
          // 竖栏：每 0.25 m 一根
          const bars = Math.max(1, Math.round(Math.hypot(q.x - p.x, q.y - p.y) / 2));
          g.lineStyle(1, 0x2b3442, 1);
          for (let i = 0; i <= bars; i++) {
            const x = Math.round(p.x + ((q.x - p.x) * i) / bars), y = Math.round(p.y + ((q.y - p.y) * i) / bars);
            g.lineBetween(x + 0.5, y, x + 0.5, y - H);
          }
          g.lineStyle(1, 0x2a2433, 1);
          for (const h of [1, H - 3, H - 1]) g.lineBetween(p.x, p.y - h + 0.5, q.x, q.y - h + 0.5);
          g.setDepth(Math.max(p.y, q.y));
          this.keep(g, new Phaser.Geom.Rectangle(Math.min(p.x, q.x), Math.min(p.y, q.y) - H, Math.abs(q.x - p.x) + 2, Math.abs(q.y - p.y) + H + 1));
        }
      }
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
      const at = this.toView(p.x, p.y);
      this.cam = { x: at.x, y: at.y - 12 };
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
    const at = this.toView(a.av.x, a.av.y);
    const img = this.add.image(at.x, at.y - LABEL_LIFT, 'emotes', emote).setOrigin(0.5, 1).setDepth(GHOST_DEPTH + 1);
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
      // 按键是屏幕方向，换成世界方向
      const sx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
      const sy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
      ({ x: vx, y: vy } = fromView(this.view, 0, 0, sx, sy));
    }
    if (vx || vy) this.route = [];
    else {
      while (this.route.length && Math.hypot(this.route[0].x - me.av.x, this.route[0].y - me.av.y) < 2) this.route.shift();
      if (this.route.length) (vx = this.route[0].x - me.av.x), (vy = this.route[0].y - me.av.y);
    }
    const len = Math.hypot(vx, vy);
    // 开发者模式：按住 Shift 加速（Vite 开发时才有）
    const boost = import.meta.env.DEV && !typing && this.shift.isDown ? DEV_BOOST : 1;
    let moved = false;
    if (len > 0) {
      // 沿路线走时最后一小步正好落在路点上，不来回抖
      const step = Math.min(WALK_SPEED * boost * dt, this.route.length ? len : Infinity) / len;
      let { x, y } = me.av;
      // 分轴移动：贴着墙也能顺着滑过去
      if (vx && !this.walk.footBlocked(x + vx * step, y)) (x += vx * step), (moved = true);
      if (vy && !this.walk.footBlocked(x, y + vy * step)) (y += vy * step), (moved = true);
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
      // 朝向按屏幕上的移动方向取，再换回世界朝向
      const sv = toView(this.view, 0, 0, vx, vy);
      const sd = Math.abs(sv.x) > Math.abs(sv.y) ? (sv.x < 0 ? DIR.left : DIR.right) : sv.y < 0 ? DIR.up : DIR.down;
      me.av.dir = dirFromView(this.view, sd);
      me.av.place(x, y);
    }
    me.av.moving = moved;
    me.av.update(dt * boost);
    this.net?.move(me.av.x, me.av.y, me.av.dir, moved);
  }

  private moveRemote(a: Actor, dt: number): void {
    const dx = a.tx - a.av.x, dy = a.ty - a.av.y;
    const d = Math.hypot(dx, dy);
    if (d > 6 * TILE) a.av.place(a.tx, a.ty);
    else if (d > 0.5) {
      // 平时按步速追；对方跑得快（开发者加速）时按距离加快，不至于落后太多被瞬移
      const s = Math.min(d, Math.max(WALK_SPEED * 1.3, d * 8) * dt);
      a.av.place(a.av.x + (dx / d) * s, a.av.y + (dy / d) * s);
    }
    if (d > 1) a.av.moving = true;
    a.av.update(dt);
  }

  // ---------- 相机与覆盖层 ----------

  private applyZoom(): void {
    const { width, height } = this.scale;
    // 整数倍放大：默认桌面 2 倍，手机 1 倍（1 m = 16 px，桌面一屏约 60 m 宽）；玩家缩放过就用玩家选的
    const zoom = this.userZoom ?? (Math.min(width, height) >= 600 ? 2 : 1);
    this.cameras.main.setZoom(zoom);
    const s = viewSize(this.view, this.worldPx.w, this.worldPx.h);
    this.cameras.main.setBounds(0, 0, s.w, s.h);
    this.uiCam.setSize(width, height);
  }

  private followCamera(dt: number): void {
    const cam = this.cameras.main;
    if (this.me) {
      const k = 1 - Math.pow(0.0001, dt);
      const p = this.toView(this.me.av.x, this.me.av.y);
      this.cam.x += (p.x - this.cam.x) * k;
      this.cam.y += (p.y - 12 - this.cam.y) * k;
    }
    // 镜头不出地图
    const hw = cam.width / cam.zoom / 2, hh = cam.height / cam.zoom / 2;
    const { w: W, h: H } = viewSize(this.view, this.worldPx.w, this.worldPx.h);
    this.cam.x = Phaser.Math.Clamp(this.cam.x, hw, W - hw);
    this.cam.y = Phaser.Math.Clamp(this.cam.y, hh, H - hh);
    // 对齐到屏幕像素，避免像素抖动
    const z = cam.zoom;
    cam.centerOn(Math.round(this.cam.x * z) / z, Math.round(this.cam.y * z) / z);
  }

  private placeDest(): void {
    const end = this.route[this.route.length - 1];
    this.dest.setVisible(!!end);
    this.destGhost.setVisible(!!end);
    if (!end) return;
    const p = this.toView(end.x, end.y);
    this.dest.setPosition(p.x, p.y - 2);
    this.destGhost.setPosition(p.x, p.y - 2);
  }

  /** 视角坐标 → 屏幕像素 */
  private viewToScreen(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return { x: Math.round((x - cam.midPoint.x) * cam.zoom + cam.width / 2), y: Math.round((y - cam.midPoint.y) * cam.zoom + cam.height / 2) };
  }

  /** 屏幕像素 → 视角坐标 */
  private screenToView(x: number, y: number): { x: number; y: number } {
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
          parts.push({ h: img.height * zoom + 2, w: img.width * zoom, place: (x, b) => img.setPosition(this.screenToView(x, b).x, this.screenToView(x, b).y) });
        }
        if (a.say) {
          const t = a.say.text;
          parts.push({ h: t.height + 2, w: t.width, place: (x, b) => t.setPosition(x, b) });
        }
        const p = this.toView(a.av.x, a.av.y);
        const s = this.viewToScreen(p.x, p.y - LABEL_LIFT);
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

function loadZoom(): number | null {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return Number.isInteger(z) && z >= ZOOM_MIN && z <= ZOOM_MAX ? z : null;
  } catch {
    return null;
  }
}
