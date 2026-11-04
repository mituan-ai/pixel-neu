// 全图：铺满屏幕的整张校园地图，固定上北。滚轮或双指缩放、拖动平移，点地图上的地方或地标名就走过去。
// 只有地图本身和右上角的关闭按钮；OpenStreetMap 署名写在右下角。
// 底图和小地图共用一张（每格一个像素），这里只按当前缩放放大绘制，再叠上地标、玩家和终点。
import { TILE } from '../shared/world.ts';
import { PIXEL_FONT } from './scene.ts';
import { el } from './ui/dom.ts';

export interface AtlasSource {
  dots(): { x: number; y: number; self: boolean }[];
  landmarks: { name: string; x: number; y: number }[];
  destination(): { x: number; y: number } | null;
}

export interface AtlasActions {
  /** 走到世界坐标，走不到返回 false */
  walkTo(x: number, y: number): boolean;
  toast(msg: string): void;
}

/** 最大放大：一格 12 个屏幕像素 */
const SCALE_MAX = 12;
/** 比例尺长度（米） */
const BAR_M = 100;
/** 按下到松开移动不超过这么多像素算点击，不算拖动 */
const CLICK_SLOP = 5;

export class Atlas {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private fit = 1;
  private raf = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragged = 0;
  /** 画面上地标名的占位，点击时用 */
  private labelBoxes: { name: string; x: number; y: number; l: number; t: number; r: number; b: number }[] = [];

  private readonly base: HTMLCanvasElement;
  private readonly src: AtlasSource;
  private readonly actions: AtlasActions;

  constructor(base: HTMLCanvasElement, src: AtlasSource, actions: AtlasActions) {
    this.base = base;
    this.src = src;
    this.actions = actions;
    this.el = el('div', 'atlas hidden');
    const frame = el('div', 'atlas-frame');
    this.canvas = el('canvas', 'atlas-map');
    const close = el('button', 'icon-btn atlas-close', '✕');
    close.title = '关闭（M / Esc）';
    close.setAttribute('aria-label', '关闭全图');
    close.addEventListener('click', () => this.hide());
    frame.append(this.canvas, close, el('div', 'atlas-credit', '© OpenStreetMap 贡献者'));
    this.el.append(frame);
    // 点背板空白处关闭
    this.el.addEventListener('pointerdown', (e) => e.target === this.el && this.hide());
    this.bindPointer();
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }

  show(): void {
    this.el.classList.remove('hidden');
    this.resize();
    this.fitAll();
    // 打开时先看全图，再拉近到自己附近，一眼看到自己在哪
    this.centerSelf(Math.max(this.fit, 3));
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    loop();
  }

  hide(): void {
    this.el.classList.add('hidden');
    cancelAnimationFrame(this.raf);
    this.pointers.clear();
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
  }

  private get size(): { w: number; h: number } {
    const dpr = window.devicePixelRatio || 1;
    return { w: this.canvas.width / dpr, h: this.canvas.height / dpr };
  }

  private fitAll(): void {
    const { w, h } = this.size;
    this.fit = Math.min(w / this.base.width, h / this.base.height);
    this.scale = this.fit;
    this.ox = (w - this.base.width * this.scale) / 2;
    this.oy = (h - this.base.height * this.scale) / 2;
  }

  private centerSelf(scale = this.scale): void {
    const self = this.src.dots().find((d) => d.self);
    if (!self) return;
    const { w, h } = this.size;
    this.scale = Math.min(SCALE_MAX, scale);
    this.ox = w / 2 - (self.x / TILE) * this.scale;
    this.oy = h / 2 - (self.y / TILE) * this.scale;
  }

  /** 以屏幕点 (cx, cy) 为中心缩放，默认画面中心 */
  private zoomAt(k: number, cx = this.size.w / 2, cy = this.size.h / 2): void {
    const s = Math.min(SCALE_MAX, Math.max(this.fit * 0.8, this.scale * k));
    this.ox = cx - ((cx - this.ox) * s) / this.scale;
    this.oy = cy - ((cy - this.oy) * s) / this.scale;
    this.scale = s;
  }

  private go(x: number, y: number, name?: string): void {
    if (this.actions.walkTo(x, y)) {
      this.hide();
      this.actions.toast(name ? `正在前往${name}` : '正在前往目的地');
    } else this.actions.toast('那里走不过去，换个地方试试');
  }

  private bindPointer(): void {
    const c = this.canvas;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      this.zoomAt(Math.pow(1.0015, -e.deltaY), p.x, p.y);
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, local(e));
      if (this.pointers.size === 1) this.dragged = 0;
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const p = local(e);
      if (this.pointers.size === 1) {
        this.ox += p.x - prev.x;
        this.oy += p.y - prev.y;
        this.dragged += Math.hypot(p.x - prev.x, p.y - prev.y);
      } else if (this.pointers.size === 2) {
        // 双指：按两指距离的变化缩放，中点跟手平移
        const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y), d1 = Math.hypot(p.x - other.x, p.y - other.y);
        const m0 = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 }, m1 = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
        if (d0 > 0) this.zoomAt(d1 / d0, m0.x, m0.y);
        this.ox += m1.x - m0.x;
        this.oy += m1.y - m0.y;
        this.dragged = Infinity;
      }
      this.pointers.set(e.pointerId, p);
    });
    const up = (e: PointerEvent) => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (this.pointers.size || this.dragged > CLICK_SLOP || e.type === 'pointercancel') return;
      const p = local(e);
      const hit = this.labelBoxes.find((b) => p.x >= b.l && p.x <= b.r && p.y >= b.t && p.y <= b.b);
      if (hit) this.go(hit.x, hit.y, hit.name);
      else this.go(((p.x - this.ox) / this.scale) * TILE, ((p.y - this.oy) / this.scale) * TILE);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    window.addEventListener('resize', () => this.open && this.resize());
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = this.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#2a2433';
    ctx.fillRect(0, 0, w, h);
    const s = this.scale;
    // 地图比画面大时不让边缘露出空白，比画面小时居中
    const mw = this.base.width * s, mh = this.base.height * s;
    this.ox = mw > w ? Math.min(0, Math.max(w - mw, this.ox)) : (w - mw) / 2;
    this.oy = mh > h ? Math.min(0, Math.max(h - mh, this.oy)) : (h - mh) / 2;
    ctx.drawImage(this.base, this.ox, this.oy, mw, mh);
    const at = (x: number, y: number) => ({ x: this.ox + (x / TILE) * s, y: this.oy + (y / TILE) * s });

    // 终点
    const dest = this.src.destination();
    if (dest) {
      const p = at(dest.x, dest.y);
      ctx.strokeStyle = '#f0c94a';
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(p.x) - 5, Math.round(p.y) - 5, 10, 10);
    }
    // 其他玩家白点，自己是带描边的金色方块
    const dots = this.src.dots();
    const r = Math.max(2, Math.round(s * 0.75));
    ctx.fillStyle = '#ffffff';
    for (const d of dots) {
      if (d.self) continue;
      const p = at(d.x, d.y);
      ctx.fillRect(Math.round(p.x) - r / 2, Math.round(p.y) - r / 2, r, r);
    }
    const self = dots.find((d) => d.self);
    if (self) {
      const p = at(self.x, self.y);
      const pulse = 6 + Math.round(((performance.now() / 120) % 6));
      ctx.strokeStyle = 'rgba(240, 201, 74, 0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(p.x) - pulse, Math.round(p.y) - pulse, pulse * 2, pulse * 2);
      ctx.fillStyle = '#2a2433';
      ctx.fillRect(Math.round(p.x) - 5, Math.round(p.y) - 5, 10, 10);
      ctx.fillStyle = '#f0c94a';
      ctx.fillRect(Math.round(p.x) - 3, Math.round(p.y) - 3, 6, 6);
    }

    // 地标名：白字黑边，名字下面一个小点
    ctx.font = `12px ${PIXEL_FONT}`;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'center';
    this.labelBoxes = [];
    for (const l of this.src.landmarks) {
      const p = at(l.x, l.y);
      if (p.x < -60 || p.y < -20 || p.x > w + 60 || p.y > h + 20) continue;
      const x = Math.round(p.x), y = Math.round(p.y);
      ctx.fillStyle = '#2a2433';
      ctx.fillRect(x - 3, y - 3, 6, 6);
      ctx.fillStyle = '#a86f5a';
      ctx.fillRect(x - 2, y - 2, 4, 4);
      const tw = ctx.measureText(l.name).width;
      const box = { name: l.name, x: l.x, y: l.y, l: x - tw / 2 - 4, t: y - 22, r: x + tw / 2 + 4, b: y + 3 };
      // 和已画的名字重叠就只画点，放大后再显示
      if (this.labelBoxes.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)) continue;
      ctx.fillStyle = 'rgba(42, 36, 51, 0.8)';
      ctx.fillRect(x - tw / 2 - 4, y - 22, tw + 8, 16);
      ctx.fillStyle = '#f4f2ec';
      ctx.fillText(l.name, x, y - 7);
      this.labelBoxes.push(box);
    }

    // 指北针和比例尺
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(42, 36, 51, 0.8)';
    ctx.fillRect(10, 10, 26, 30);
    ctx.fillStyle = '#f0c94a';
    ctx.beginPath();
    ctx.moveTo(23, 14);
    ctx.lineTo(29, 26);
    ctx.lineTo(17, 26);
    ctx.fill();
    ctx.fillStyle = '#f4f2ec';
    ctx.fillText('北', 17, 40);
    const bar = (BAR_M / 2) * s;
    ctx.fillStyle = 'rgba(42, 36, 51, 0.8)';
    ctx.fillRect(10, h - 34, bar + 16, 24);
    ctx.fillStyle = '#f4f2ec';
    ctx.fillRect(18, h - 16, bar, 3);
    ctx.fillRect(18, h - 20, 2, 7);
    ctx.fillRect(18 + bar - 2, h - 20, 2, 7);
    ctx.fillText(`${BAR_M} m`, 22, h - 18);
  }
}
