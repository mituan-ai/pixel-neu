// 校园场景：地图、建筑与物件、角色移动、名字与气泡。
// 两台相机：主相机按整数倍放大画世界（像素保持方正），界面相机不缩放，只画名字和短语气泡（文字清晰）。
// 四个视角：角色、寻路、碰撞、网络都用世界坐标；只有画到屏幕上时换算成当前视角的坐标（shared/view.ts）。
// 切换视角时地面、建筑、物件整套重建，角色重新摆位。
// 楼和地面都按视野加载：只有镜头附近的楼贴图才下载、上显存，离远了就卸掉。
import Phaser from 'phaser';
import { AVATAR, DIR, PHRASES, cleanLook, type Look } from '../shared/social.ts';
import type { Player } from '../shared/state.ts';
import { vehicleKey } from '../shared/vehicles.ts';
import { VIEW_NAME, dirFromView, dirToView, fromView, toView, viewSize, type View } from '../shared/view.ts';
import { DEV_BOOST, GROUND_CHUNK, LAYER, RIDE_FACTOR, RIDE_REACH, TILE, WALK_SPEED, Walkable, isRideable, prop, type TiledMap, type TiledObject } from '../shared/world.ts';
import { PAL } from '../tools/palette.ts';
import type { Body } from '../shared/sky.ts';
import { Avatar, GHOST_DEPTH, display, mulColor } from './avatar.ts';
import { Ambient } from './ambient.ts';
import { Shadows, type Tree } from './shadows.ts';
import type { Hello, Net, NetHandlers } from './net.ts';

export const PIXEL_FONT = '"Fusion Pixel", "PingFang SC", "Microsoft YaHei", sans-serif';

export interface Poi {
  name: string;
  text: string;
  src: string;
  x: number;
  y: number;
  r: number;
}

/** 场景通知界面层的事件；联机的其他事件（聊天、天气）由 main.ts 直接转给界面 */
export interface SceneHooks {
  poi(p: Poi | null): void;
  count(n: number): void;
  /** 骑车按钮：near 是走到了单车旁边，riding 是正在骑，null 不显示 */
  ride(state: 'near' | 'riding' | null): void;
}

/** 一栋楼：贴图按视野加载，摆出来的是按列切开的几段 */
interface Bld {
  o: TiledObject;
  key: string;
  /** 当前视角下的包围盒（含楼高） */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  imgs: Phaser.GameObjects.Image[];
  /** 每段切下的列范围（贴图像素） */
  crops: [number, number][];
  /** 夜里的窗灯，和 imgs 一一对应 */
  lights: Phaser.GameObjects.Image[];
}

/** 积雪：草地的颜色换成雪色，路面保持本色（当作已经扫过） */
const SNOW: [number, number][] = [
  [PAL.grass0, PAL.stone2],
  [PAL.grass1, PAL.stone3],
  [PAL.grass2, PAL.stone3],
  [PAL.grass3, PAL.white],
];

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
/** 双指捏合到这个比例缩放一档，拧过这个角度转一次视角 */
const PINCH = 1.35;
const TWIST = Math.PI / 4;
/** 聊天气泡最宽（屏幕像素） */
const BUBBLE_W = 160;

interface Actor {
  av: Avatar;
  name: string;
  label: Phaser.GameObjects.Text;
  /** 远端玩家的目标位置（本地玩家不用） */
  tx: number;
  ty: number;
  emote?: { img: Phaser.GameObjects.Image; until: number };
  say?: { text: Phaser.GameObjects.Text; until: number };
  look: Look;
  /** 正在骑的单车（地图物件编号），0 是步行 */
  ride: number;
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
  private me?: Actor & { id: string; guest: boolean };
  /** 访客自己的外观（只在本机） */
  guestLook: Look = cleanLook(undefined);
  private blds: Bld[] = [];
  /** 摇杆输入：屏幕方向，长度 0–1 */
  private stickV = { x: 0, y: 0 };
  /** 双指手势的起点 */
  private gesture: { d: number; a: number } | null = null;
  /** 第一批楼贴图加载完（加载页等它） */
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  /** create() 跑完 */
  readonly created: Promise<void>;
  private resolveCreated!: () => void;
  /** 昼夜色调（乘到所有世界物体上） */
  private shade = 0xffffff;
  private lightsOn = false;
  private snowy = false;
  private lamps: Phaser.GameObjects.Image[] = [];
  private shadows!: Shadows;
  private ambient!: Ambient;
  /** 能骑的单车：地图物件编号 → 位置和物件名；bikeImgs 是它们当前视角下的图 */
  private bikes = new Map<number, { x: number; y: number; sprite: string }>();
  private bikeImgs = new Map<number, Phaser.GameObjects.Image>();
  private rideState: 'near' | 'riding' | null = null;
  /** 跟着镜头走的覆盖物（雨雪粒子） */
  private overlays: Phaser.GameObjects.GameObject[] = [];
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
    this.ready = new Promise((r) => (this.resolveReady = r));
    this.created = new Promise((r) => (this.resolveCreated = r));
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
    for (const a of ['fx', 'fauna', 'vehicles']) {
      this.load.image(a, `${a}.png`);
      this.load.json(`${a}-meta`, `${a}.json`);
    }
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
    // 图集的锚点（ax、ay）是脚底，换算成 Phaser 帧的枢轴
    for (const a of ['fx', 'fauna', 'vehicles']) {
      const t = this.textures.get(a);
      for (const [name, m] of Object.entries(this.cache.json.get(`${a}-meta`) as Record<string, { x: number; y: number; w: number; h: number; ax?: number; ay?: number }>)) {
        const f = t.add(name, 0, m.x, m.y, m.w, m.h);
        if (a === 'fx' || !f || m.ax === undefined) continue;
        f.customPivot = true;
        f.pivotX = m.ax / m.w;
        f.pivotY = (m.ay ?? m.h) / m.h;
      }
    }
    this.shadows = new Shadows(this, this.worldLayer);
    this.shadows.setTrees(this.trees());
    this.shadows.setView(this.view, (x, y) => this.toView(x, y));
    for (const o of this.objects('prop')) if (isRideable(prop(o, 'sprite', ''))) this.bikes.set(o.id, { x: o.x, y: o.y, sprite: prop(o, 'sprite', '') });
    this.buildScenery();
    this.ambient = new Ambient(this, this.worldLayer, {
      walk: this.walk,
      trees: this.trees().map((t) => ({ x: t.x * (TILE / 2), y: t.y * (TILE / 2), h: t.h })),
      doors: this.objects('door').map((o) => ({ x: o.x, y: o.y, facing: 'NESW'.indexOf(prop(o, 'facing', 'S')) })),
      lanes: this.objects('lane').map((o) => (o.polyline ?? []).map((q) => ({ x: o.x + q.x, y: o.y + q.y }))),
      toView: (x, y) => this.toView(x, y),
    });
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
    // 点击或触摸地面：走过去；两个手指按下时是捏合缩放、拧转视角
    this.input.addPointer(1);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const [a, b] = [this.input.pointer1, this.input.pointer2];
      if (a.isDown && b.isDown) {
        this.route = [];
        this.gesture = { d: Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
        return;
      }
      if (!this.me) return;
      const s = this.screenToView(p.x, p.y);
      const w = this.fromView(s.x, s.y);
      this.walkTo(w.x, w.y);
    });
    this.input.on('pointermove', () => {
      const [a, b] = [this.input.pointer1, this.input.pointer2];
      if (!this.gesture || !a.isDown || !b.isDown) return;
      const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (d / this.gesture.d > PINCH || this.gesture.d / d > PINCH) {
        this.zoomBy(d > this.gesture.d ? 1 : -1);
        this.gesture.d = d;
      }
      const turn = Phaser.Math.Angle.Wrap(ang - this.gesture.a);
      // 顺时针拧，地图跟着顺时针转：屏幕上方的方向往西退一格
      if (Math.abs(turn) > TWIST) {
        this.rotate(turn > 0 ? -1 : 1);
        this.gesture.a = ang;
      }
    });
    this.input.on('pointerup', () => {
      if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) this.gesture = null;
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
    this.followCamera(0);
    this.updateBuildings(true);
    this.resolveCreated();
  }

  /** 出生点（连不上服务器时在这里放一个离线的自己） */
  get spawnPoint(): { x: number; y: number } {
    const o = this.objects('spawn')[0];
    return { x: o.x, y: o.y };
  }

  /** 交给 Net.join 的回调：服务端状态变化 → 场景 */
  readonly handlers: Pick<NetHandlers, 'hello' | 'add' | 'change' | 'remove' | 'emote' | 'say' | 'snap'> = {
    hello: (h) => this.hello(h),
    add: (id, p, self) => this.addActor(id, p, self),
    change: (id, p) => {
      const a = this.actor(id);
      if (!a) return;
      const look = cleanLook(p);
      if (JSON.stringify(look) !== JSON.stringify(a.look)) (a.look = look), a.av.setLook(look);
      if (p.name !== a.name) (a.name = p.name), a.label.setText(p.name);
      if (p.ride !== a.ride) this.setRide(a, p.ride);
      if (a === this.me) return;
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
      this.refreshBikes();
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
  };

  attach(net: Net): void {
    this.net = net;
  }

  /** 换账号重连前：清掉所有角色，自己的位置留给新房间参考 */
  detach(): { x: number; y: number } | null {
    const at = this.me ? { x: this.me.av.x, y: this.me.av.y } : null;
    for (const a of this.actors()) this.destroyActor(a);
    this.others.clear();
    this.me = undefined;
    this.net = undefined;
    this.route = [];
    return at;
  }

  /** 服务端的欢迎消息：访客不在 players 里，自己在本地造一个半透明的角色 */
  private hello(h: Hello): void {
    if (h.visible || this.me) return;
    const av = new Avatar(this, this.worldLayer, this.guestLook, h.x, h.y, true);
    av.setShade(this.shade);
    av.setAlpha(0.6);
    this.me = { av, name: '访客', label: this.label('访客', true), tx: h.x, ty: h.y, look: this.guestLook, id: '', guest: true, ride: 0 };
    this.me.label.setColor('#fff3d6');
    const at = this.toView(h.x, h.y);
    this.cam = { x: at.x, y: at.y - 12 };
    this.hooks.count(this.others.size + 1);
  }

  /** 摇杆：屏幕方向向量 */
  setStick(x: number, y: number): void {
    this.stickV = { x, y };
    if (x || y) this.route = [];
  }

  /** 自己是访客（别人看不到） */
  get guest(): boolean {
    return !this.me || this.me.guest;
  }

  /** 头顶的聊天气泡（附近频道） */
  showChat(id: string, text: string): void {
    this.bubble(id, text);
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
    this.shadows.setView(this.view, (x, y) => this.toView(x, y));
    this.ambient.setView(this.view);
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
    this.updateShadows();
    this.updateAmbient(dt);
    this.placeDest();
    this.updateOverlays();
    this.checkPoi();
    if ((this.game.loop.frame & 7) === 0) this.checkRide();
  }

  // ---------- 世界 ----------

  private buildScenery(): void {
    for (const o of this.scenery) o.destroy();
    this.scenery = [];
    for (const b of this.blds) this.unloadBuilding(b, true);
    this.culled = [];
    this.cullAt = '';
    for (const img of this.groundImgs.values()) img.destroy();
    this.groundImgs.clear();
    this.groundAt = '';
    this.buildBuildings();
    this.buildProps();
    this.buildFences();
    this.buildLamps();
    this.refreshBikes();
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
    this.updateBuildings();
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
      if (this.textures.exists(`g${k}s`)) this.textures.remove(`g${k}s`);
    }
  }

  private placeChunk(k: string): void {
    if (this.groundImgs.has(k)) return;
    const [c, r] = k.split('-').map(Number);
    const src = this.textures.get(`g${k}`).getSourceImage();
    const p = this.toView(c * GROUND_CHUNK + src.width / 2, r * GROUND_CHUNK + src.height / 2);
    const img = this.add.image(p.x, p.y, this.snowy ? this.snowTexture(k) : `g${k}`).setAngle(-90 * this.view).setDepth(-10).setTint(this.shade);
    this.worldLayer.add(img);
    this.groundImgs.set(k, img);
  }

  /** 记下每栋楼在当前视角下的包围盒；贴图等 updateBuildings 按视野加载 */
  private buildBuildings(): void {
    this.blds = this.objects('building').map((o) => {
      const a = this.toView(o.x, o.y), b = this.toView(o.x + o.width, o.y + o.height);
      const top = prop(o, 'top', 0);
      return {
        o,
        key: `${prop(o, 'sprite', '')}-${VIEW_NAME[this.view]}`,
        x0: Math.min(a.x, b.x) - TILE,
        y0: Math.min(a.y, b.y) - top - TILE,
        x1: Math.max(a.x, b.x) + 4 * TILE,
        y1: Math.max(a.y, b.y) + 4 * TILE,
        imgs: [],
        crops: [],
        lights: [],
      };
    });
  }

  /**
   * 视野外扩一块以内的楼：贴图没下载就下载，下载好了摆出来；外扩三块以外的拆掉、卸掉贴图。
   * first 为 true 时，等这一批都下载完才算 ready（加载页用）
   */
  private updateBuildings(first = false): void {
    const v = this.cameras.main.worldView;
    const near = (b: Bld, pad: number) => b.x1 >= v.x - pad && b.x0 <= v.right + pad && b.y1 >= v.y - pad && b.y0 <= v.bottom + pad;
    let pending = 0;
    for (const b of this.blds) {
      if (near(b, CHUNK)) {
        if (b.imgs.length) continue;
        if (this.textures.exists(b.key)) this.placeBuilding(b);
        else {
          pending++;
          if (this.loadingKeys.has(b.key)) continue;
          this.loadingKeys.add(b.key);
          this.load.image(b.key, `buildings/${b.key}.png`);
          this.load.once(`filecomplete-image-${b.key}`, () => {
            this.loadingKeys.delete(b.key);
            const cur = this.blds.find((x) => x.key === b.key);
            if (cur && near(cur, 2 * CHUNK)) this.placeBuilding(cur);
          });
        }
      } else if (!near(b, 3 * CHUNK)) this.unloadBuilding(b, false);
    }
    if (first) {
      if (!pending) this.resolveReady();
      else this.load.once('complete', () => this.resolveReady());
    }
    if (pending && !this.load.isLoading()) this.load.start();
  }

  private readonly loadingKeys = new Set<string>();

  /**
   * 建筑按 16 像素一列切成几段，每段的深度取这一列楼基最靠前（屏幕最下）的那一行（地图里的 front）：
   * U 形楼的院子里，人会正确地站在后楼前面、前楼后面
   */
  private placeBuilding(b: Bld): void {
    if (b.imgs.length || !this.textures.exists(b.key)) return;
    const o = b.o;
    const top = prop(o, 'top', 0);
    const fronts = Object.fromEntries(prop(o, 'front', '').split('|').map((f) => [f[0], f.slice(2).split(',').map(Number)]));
    const base: number[] = fronts[VIEW_NAME[this.view]];
    const a = this.toView(o.x, o.y), c = this.toView(o.x + o.width, o.y + o.height);
    const x0 = Math.min(a.x, c.x), y0 = Math.min(a.y, c.y);
    const tex = this.textures.get(b.key).getSourceImage() as HTMLImageElement;
    let c0 = 0;
    for (let k = 1; k <= base.length; k++) {
      if (k < base.length && base[k] === base[c0]) continue;
      const last = k === base.length;
      const w = last ? tex.width - c0 * TILE : (k - c0) * TILE;
      const img = this.add.image(x0, y0 - top, b.key).setOrigin(0, 0).setCrop(c0 * TILE, 0, w, tex.height);
      img.setDepth(base[c0] >= 0 ? y0 + base[c0] + 1 : 0).setTint(this.shade);
      this.worldLayer.add(img);
      b.imgs.push(img);
      b.crops.push([c0 * TILE, w]);
      c0 = k;
    }
    if (this.lightsOn) this.lightBuilding(b);
  }

  /** 窗灯：和楼贴图同尺寸的蒙版，按同样的列切开，深度紧贴对应那段楼 */
  private lightBuilding(b: Bld): void {
    if (b.lights.length || !b.imgs.length) return;
    const key = `${b.key}-light`;
    if (!this.textures.exists(key)) {
      if (this.loadingKeys.has(key)) return;
      this.loadingKeys.add(key);
      this.load.image(key, `buildings/${key}.png`);
      this.load.once(`filecomplete-image-${key}`, () => {
        this.loadingKeys.delete(key);
        const cur = this.blds.find((x) => x.key === b.key);
        if (cur && this.lightsOn) this.lightBuilding(cur);
      });
      if (!this.load.isLoading()) this.load.start();
      return;
    }
    for (const [i, img] of b.imgs.entries()) {
      const [cx, cw] = b.crops[i];
      const l = this.add.image(img.x, img.y, key).setOrigin(0, 0).setCrop(cx, 0, cw, img.height);
      l.setDepth(img.depth + 0.01).setAlpha(0.95);
      this.worldLayer.add(l);
      b.lights.push(l);
    }
  }

  private unlightBuilding(b: Bld): void {
    for (const l of b.lights) l.destroy();
    b.lights = [];
    if (this.textures.exists(`${b.key}-light`)) this.textures.remove(`${b.key}-light`);
  }

  /** 拆掉一栋楼；dropTexture 时连贴图一起卸（换视角时旧视角的贴图都卸掉） */
  private unloadBuilding(b: Bld, always: boolean): void {
    if (!b.imgs.length && !always) return;
    for (const img of b.imgs) img.destroy();
    b.imgs = [];
    b.crops = [];
    this.unlightBuilding(b);
    if (this.textures.exists(b.key)) this.textures.remove(b.key);
  }

  /** 物件：四个视角各一张的叫「名字@N」等；rot 是物件相对美术朝向转了几个 90°，换算出该用哪个视角的图 */
  private buildProps(): void {
    this.bikeImgs.clear();
    const meta = this.cache.json.get('props-meta') as Record<string, { w: number; h: number; ax: number; ay: number }>;
    for (const o of this.objects('prop')) {
      const name = prop(o, 'sprite', '');
      const p = this.toView(o.x, o.y);
      if (name.startsWith('v:')) {
        // 车型目录里的车和单车：rot 是车头的世界朝向（0 北，顺时针），换成当前视角下的屏幕朝向
        const [, id, paint] = name.split(':');
        const dir = dirToView(this.view, [DIR.up, DIR.right, DIR.down, DIR.left][prop(o, 'rot', 0) % 4]);
        const img = this.add.image(p.x, p.y, 'vehicles', vehicleKey(id, Number(paint), dir, 0)).setDepth(p.y).setTint(this.shade);
        this.keep(img, img.getBounds());
        if (this.bikes.has(o.id)) this.bikeImgs.set(o.id, img);
        continue;
      }
      const frame = meta[name] ? name : `${name}@${VIEW_NAME[(this.view - prop(o, 'rot', 0) + 8) % 4]}`;
      const m = meta[frame];
      if (!m) continue;
      // 平铺在地上的（台阶）画在地面之上、一切站立物之下
      const img = this.add.image(p.x, p.y, 'props', frame).setOrigin(m.ax / m.w, m.ay / m.h).setDepth(prop(o, 'flat', false) ? -5 : p.y).setTint(this.shade);
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

  /** 路灯、楼门口的灯：地面上的光斑，加亮混合，只在夜里显示 */
  private buildLamps(): void {
    this.lamps = [];
    const add = (x: number, y: number, frame: string, alpha: number) => {
      const p = this.toView(x, y);
      const img = this.add.image(p.x, p.y, 'fx', frame).setBlendMode(Phaser.BlendModes.ADD).setDepth(-6).setAlpha(alpha).setVisible(this.lightsOn);
      this.keep(img, img.getBounds());
      this.lamps.push(img);
    };
    for (const o of this.objects('prop')) if (String(prop(o, 'sprite', '')) === 'lamp') add(o.x, o.y, 'lamp-glow', 0.5);
    // 门的光斑朝门外展开：贴图朝屏幕下方，按门的朝向转
    for (const o of this.objects('door')) {
      const facing = 'NESW'.indexOf(prop(o, 'facing', 'S'));
      const p = this.toView(o.x, o.y);
      const img = this.add.image(p.x, p.y, 'fx', 'door-glow').setOrigin(0.5, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(-6).setAlpha(0.6);
      // 贴图朝南（屏幕下方）；门朝 facing，当前视角上方是 view
      img.setAngle(90 * ((facing - 2 - this.view + 8) % 4)).setVisible(this.lightsOn);
      this.keep(img, img.getBounds());
      this.lamps.push(img);
    }
  }

  /** 树的位置和大小（米），给投影用。树名里的数字是树冠半径（分米） */
  private trees(): Tree[] {
    const out: Tree[] = [];
    const ppm = TILE / 2;
    for (const o of this.objects('prop')) {
      const name = prop(o, 'sprite', '');
      const m = /^(tree|pine)-(\d+)$/.exec(name);
      if (m) {
        const r = Number(m[2]) / 10;
        // 阔叶树冠中心约在 1.6R + 1.4 m，针叶树取树高的一半（树高约 3.2R），与 tools/art.ts 的画法一致
        out.push({ x: o.x / ppm, y: o.y / ppm, r: m[1] === 'tree' ? r : r * 0.8, h: m[1] === 'tree' ? 1.6 * r + 1.4 : 1.6 * r + 0.6 });
      } else if (name.startsWith('conifer-column')) out.push({ x: o.x / ppm, y: o.y / ppm, r: 0.8, h: 3 });
    }
    return out;
  }

  /** 昼夜色调：乘到地面、楼、物件和人身上；灯光不乘 */
  setShade(c: number): void {
    if (c === this.shade) return;
    this.shade = c;
    for (const img of this.groundImgs.values()) img.setTint(c);
    for (const b of this.blds) for (const img of b.imgs) img.setTint(c);
    for (const s of this.culled) if (s.o instanceof Phaser.GameObjects.Image && !this.lamps.includes(s.o)) s.o.setTint(c);
    for (const a of this.actors()) a.av.setShade(c);
    this.ambient.setShade(c);
    this.dest.setTint(mulColor(0xffffff, c));
  }

  setLights(on: boolean): void {
    if (on === this.lightsOn) return;
    this.lightsOn = on;
    this.ambient.setNight(on);
    for (const l of this.lamps) l.setVisible(on);
    for (const b of this.blds) {
      if (on) this.lightBuilding(b);
      else this.unlightBuilding(b);
    }
  }

  setSnowCover(on: boolean): void {
    if (on === this.snowy) return;
    this.snowy = on;
    for (const [k, img] of this.groundImgs) img.setTexture(on ? this.snowTexture(k) : `g${k}`);
  }

  /** 把地面分块的草地换成雪色，另存一张贴图 */
  private snowTexture(k: string): string {
    const key = `g${k}s`;
    if (this.textures.exists(key)) return key;
    const src = this.textures.get(`g${k}`).getSourceImage() as HTMLImageElement;
    const tex = this.textures.createCanvas(key, src.width, src.height)!;
    tex.context.drawImage(src, 0, 0);
    const d = tex.context.getImageData(0, 0, src.width, src.height);
    const map = new Map(SNOW);
    for (let i = 0; i < d.data.length; i += 4) {
      const to = map.get((d.data[i] << 16) | (d.data[i + 1] << 8) | d.data[i + 2]);
      if (to === undefined) continue;
      d.data[i] = to >> 16;
      d.data[i + 1] = (to >> 8) & 255;
      d.data[i + 2] = to & 255;
    }
    tex.context.putImageData(d, 0, 0);
    tex.refresh();
    return key;
  }

  /** 下雨下雪：猫躲回楼门口 */
  setWet(on: boolean): void {
    this.ambient.setWet(on);
  }

  private updateAmbient(dt: number): void {
    const v = this.cameras.main.worldView;
    const a = this.fromView(v.x, v.y), b = this.fromView(v.right, v.bottom);
    const people = this.actors().map((x) => ({ x: x.av.x, y: x.av.y, moving: x.av.moving, self: x === this.me }));
    this.ambient.update(dt, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), people);
  }

  setSun(sun: Body, strength: number): void {
    this.shadows.setSun(sun, strength);
    if (strength <= 0.02) this.shadows.hide();
  }

  /** 雨雪这类覆盖物：每帧挪到镜头中心，画在一切世界物体之上 */
  addOverlay(o: Phaser.GameObjects.GameObject & { setDepth(d: number): unknown }): void {
    o.setDepth(GHOST_DEPTH - 1);
    this.worldLayer.add(o);
    this.overlays.push(o);
  }

  private updateShadows(): void {
    const v = this.cameras.main.worldView;
    const a = this.fromView(v.x, v.y), b = this.fromView(v.right, v.bottom);
    const ppm = TILE / 2;
    this.shadows.update(Math.min(a.x, b.x) / ppm, Math.min(a.y, b.y) / ppm, Math.max(a.x, b.x) / ppm, Math.max(a.y, b.y) / ppm);
    const mid = this.cameras.main.midPoint;
    this.overlays = this.overlays.filter((o) => o.active);
    for (const o of this.overlays) (o as unknown as Phaser.GameObjects.Components.Transform).setPosition(mid.x, mid.y);
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
    av.setShade(this.shade);
    av.dir = p.dir;
    const actor: Actor = { av, name: p.name, label: this.label(p.name, self), tx: p.x, ty: p.y, look, ride: 0 };
    if (self) {
      if (this.me) this.destroyActor(this.me);
      this.me = { ...actor, id, guest: false };
      const at = this.toView(p.x, p.y);
      this.cam = { x: at.x, y: at.y - 12 };
    } else this.others.set(id, actor);
    if (p.ride) this.setRide(self ? this.me! : actor, p.ride);
    this.hooks.count(this.others.size + 1);
  }

  // ---------- 骑车 ----------

  private setRide(a: Actor, id: number): void {
    a.ride = id;
    a.av.setRide(id ? (this.bikes.get(id)?.sprite ?? null) : null);
    this.refreshBikes();
  }

  /** 有人骑走的单车不画在原位，下车后回到原位 */
  private refreshBikes(): void {
    const ridden = new Set(this.actors().map((a) => a.ride));
    for (const [id, img] of this.bikeImgs) img.setVisible(!ridden.has(id));
  }

  /** 自己身边 3 m 内没人骑的单车 */
  private nearBike(): number {
    if (!this.me) return 0;
    const ridden = new Set(this.actors().map((a) => a.ride));
    let best = 0, bd = RIDE_REACH;
    for (const [id, b] of this.bikes) {
      const d = Math.hypot(b.x - this.me.av.x, b.y - this.me.av.y);
      if (d <= bd && !ridden.has(id)) (best = id), (bd = d);
    }
    return best;
  }

  /** 骑车按钮或 R 键：骑上身边的单车，或者下车。访客返回 false（要先登录） */
  toggleRide(): boolean {
    if (!this.me || this.me.guest) return false;
    if (this.me.ride) this.net?.ride(0);
    else {
      const id = this.nearBike();
      if (id) this.net?.ride(id);
    }
    return true;
  }

  private checkRide(): void {
    const state = this.me?.ride ? 'riding' : this.nearBike() ? 'near' : null;
    if (state === this.rideState) return;
    this.rideState = state;
    this.hooks.ride(state);
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
    if (PHRASES[phrase]) this.bubble(id, PHRASES[phrase]);
  }

  private bubble(id: string, msg: string): void {
    const a = this.actor(id);
    if (!a) return;
    a.say?.text.destroy();
    const text = this.add
      .text(0, 0, msg, {
        fontFamily: PIXEL_FONT,
        fontSize: '12px',
        color: '#2a2433',
        backgroundColor: '#fffaf0',
        padding: { x: 4, y: 2 },
        wordWrap: { width: BUBBLE_W, useAdvancedWrap: true },
      })
      .setOrigin(0.5, 1)
      .setResolution(window.devicePixelRatio || 1);
    this.uiLayer.add(text);
    // 长消息多停一会儿
    a.say = { text, until: this.time.now + Math.max(BUBBLE_MS, msg.length * 150) };
  }

  private moveMe(dt: number): void {
    const me = this.me!;
    const k = this.keys;
    const typing = document.activeElement instanceof HTMLInputElement;
    let vx = 0, vy = 0;
    if (!typing) {
      // 按键是屏幕方向，换成世界方向
      let sx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
      let sy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
      if (!sx && !sy) (sx = this.stickV.x), (sy = this.stickV.y);
      ({ x: vx, y: vy } = fromView(this.view, 0, 0, sx, sy));
    }
    if (vx || vy) this.route = [];
    else {
      while (this.route.length && Math.hypot(this.route[0].x - me.av.x, this.route[0].y - me.av.y) < 2) this.route.shift();
      if (this.route.length) (vx = this.route[0].x - me.av.x), (vy = this.route[0].y - me.av.y);
    }
    const len = Math.hypot(vx, vy);
    // 开发者模式：按住 Shift 加速（Vite 开发时才有）
    const boost = (import.meta.env.DEV && !typing && this.shift.isDown ? DEV_BOOST : 1) * (me.ride ? RIDE_FACTOR : 1);
    let moved = false;
    if (len > 0) {
      // 沿路线走时最后一小步正好落在路点上，不来回抖
      // 摇杆推得浅就走得慢
      const throttle = this.route.length ? 1 : Math.min(1, len);
      const step = Math.min(WALK_SPEED * boost * throttle * dt, this.route.length ? len : Infinity) / len;
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
