// 游戏中的界面：顶栏（地点、天空条、在线人数）、右上小地图（点开全图）和转视角、底栏（聊天、菜单）、
// 访客横幅、触屏摇杆、地标卡、全图。具体面板在 chat.ts、login.ts、menu.ts、weather.ts 里。
import type { ChatLine } from '../../shared/social.ts';
import { TILE } from '../../shared/world.ts';
import { account } from '../account.ts';
import { Atlas, type AtlasSource } from '../atlas.ts';
import type { Poi } from '../scene.ts';
import type { ChatPanel } from './chat.ts';
import { button, el, iconButton, Sheet, toast, typing } from './dom.ts';
import type { Menu } from './menu.ts';
import { SkyChip } from './weather.ts';

/** 地标卡片里显示的资料来源简称，编号与 docs/sources.md 一致 */
const SOURCE_LABEL: Record<string, string> = {
  S1: 'OpenStreetMap',
  S2: 'Wikimedia Commons',
  S3: '校园平面图',
  S4: '校园照片',
  S5: '东北大学校训',
  S6: '中国新闻网',
  S7: 'Esri 卫星图',
  S8: '天地图影像',
  S9: '东大·建筑',
  S10: '信息学院院史',
  S11: '百年校庆网站',
  S12: '东大数字思政平台',
  S13: '东大数字思政平台',
  S14: '东大校友总会',
  S15: '东大图书馆',
  S16: '东大图书馆视频',
  S17: '中国大学生在线',
  S18: '东大校园号',
  S19: '东大新闻网',
  S20: '东大审计处',
  S21: '东大数字思政平台',
  S22: '东大校园号',
  S23: '东大数字思政平台',
  S24: '东大公安处供稿',
  S25: '东大数字思政平台',
  S26: 'FIBA 器材规则',
  S27: '中国运载火箭技术研究院',
  S28: '学校一舍修缮报道',
  S29: '学校二舍修缮报道',
  S30: '信息学院新生指南',
  S31: '东大百年校史',
  S32: '东大后勤宿舍表',
  S33: '东大游泳馆',
  S34: '东大体育馆',
  S35: '东大羽毛球馆',
  S36: '东大校史馆',
  S37: '人民网教育',
  S38: '东大采购中心',
  S39: '东大艺术学院',
  S40: '东大校园卡通知',
  S41: '东大后勤餐饮',
  S42: '东大理学院',
  S43: '东大研职论坛',
  S44: '东大英才计划',
};

export interface HudActions {
  rotate(step: number): void;
  zoom(step: number): void;
  walkTo(x: number, y: number): boolean;
  /** 摇杆：屏幕方向的向量，长度 0–1 */
  stick(x: number, y: number): void;
  /** 骑上身边的单车或下车 */
  ride(): void;
  login(): void;
}

export interface HudWorld extends AtlasSource {
  size: { w: number; h: number };
  zoom: number;
}

/** 小地图显示范围（格）：120 格 = 240 m */
const MINIMAP_SPAN = 120;

export class Hud {
  readonly el = el('div', 'hud');
  readonly sky = new SkyChip();
  private readonly count = el('span');
  private readonly place = el('div', 'chip place-chip', '东北大学 · 南湖校区');
  private readonly mm = el('canvas', 'minimap');
  private readonly north = el('div', 'north', '北');
  private readonly banner = el('div', 'guest-banner box');
  private readonly card = el('div', 'card box hidden');
  private readonly rideBtn: HTMLButtonElement;
  private readonly chatBtn: HTMLButtonElement;
  private readonly atlas: Atlas;
  private readonly actions: HudActions;
  private readonly world: HudWorld;
  private readonly chat: ChatPanel;
  private poi: Poi | null = null;
  private dismissed: string | null = null;

  constructor(actions: HudActions, world: HudWorld, chat: ChatPanel, menu: Menu) {
    this.actions = actions;
    this.world = world;
    this.chat = chat;

    // 顶栏
    const top = el('div', 'topbar');
    const count = el('div', 'chip count-chip');
    count.append(el('i', 'dot'), this.count);
    top.append(this.place, this.sky.el, count);
    if (import.meta.env.DEV) top.append(el('div', 'chip dev-badge', '开发者模式 · Shift 加速'));

    // 小地图和全图共用一张底图（每格一个像素）
    const mmBase = document.createElement('canvas');
    mmBase.width = world.size.w;
    mmBase.height = world.size.h;
    const img = new Image();
    img.onload = () => mmBase.getContext('2d')!.drawImage(img, 0, 0);
    img.src = 'minimap.png';
    this.atlas = new Atlas(mmBase, world, { walkTo: actions.walkTo, toast });
    this.mm.width = this.mm.height = MINIMAP_SPAN;
    setInterval(() => this.drawMinimap(mmBase), 250);

    const dock = el('div', 'dock');
    const mmBox = el('div', 'minimap-box');
    mmBox.append(this.mm, this.north);
    mmBox.title = '打开全图（M）';
    mmBox.addEventListener('click', () => this.atlas.show());
    // 缩放用滚轮、双指或 -/+，不放按钮
    const tools = el('div', 'tools');
    tools.append(
      iconButton('rotate-left', '向左转视角（Q）', () => actions.rotate(-1), ''),
      iconButton('rotate-right', '向右转视角（E）', () => actions.rotate(1), ''),
    );
    dock.append(mmBox, tools);

    // 底栏
    const bar = el('div', 'bottombar');
    this.chatBtn = button('', 'chat-open', () => chat.open(), 'chat');
    this.chatBtn.append(el('span', 'last', '说点什么…'));
    this.chatBtn.setAttribute('aria-label', '打开聊天（Enter）');
    bar.append(this.chatBtn, iconButton('menu', '菜单', () => menu.open()));
    chat.onLast = (l, n) => this.showLast(l, n);

    // 骑车：走到单车旁边才出现
    this.rideBtn = button('骑车', 'primary ride-btn hidden', () => actions.ride());
    this.rideBtn.title = '骑车 / 下车（R）';

    // 访客横幅
    this.banner.append(el('span', '', '访客 · 别人看不到你'), button('登录', 'primary small', () => actions.login(), 'login'));

    // 版权署名在「关于」和全图角上
    this.el.append(top, dock, this.card, this.banner, bar, this.rideBtn, this.atlas.el);
    if (matchMedia('(pointer: coarse)').matches) this.el.append(this.joystick());
    for (const e of [top, dock, bar, this.card, this.banner, this.rideBtn]) e.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    this.bindKeys();
    this.refreshAccount();
  }

  /** 登录状态变了：横幅、聊天输入区 */
  refreshAccount(): void {
    this.banner.classList.toggle('hidden', !!account.me);
  }

  setRide(state: 'near' | 'riding' | null): void {
    this.rideBtn.classList.toggle('hidden', !state);
    this.rideBtn.textContent = state === 'riding' ? '下车' : '骑车';
  }

  setCount(n: number): void {
    this.count.textContent = `在线 ${n}`;
  }

  setPoi(p: Poi | null): void {
    this.poi = p;
    if (!p || p.name === this.dismissed) return void this.card.classList.add('hidden');
    this.dismissed = null;
    this.card.replaceChildren();
    this.card.classList.remove('hidden');
    this.card.append(iconButton('close', '收起', () => ((this.dismissed = p.name), this.card.classList.add('hidden')), 'ghost card-close icon'));
    this.card.append(el('h2', '', p.name));
    if (p.text) this.card.append(el('p', '', p.text));
    const src = p.src.split(',').map((s) => SOURCE_LABEL[s.trim()] ?? s.trim()).filter(Boolean);
    if (src.length) this.card.append(el('p', 'src', `资料：${src.join('、')}`));
    this.place.textContent = p.name;
  }

  setView(v: number): void {
    // 视角 v 是屏幕上方的地理方向，地图要逆时针转 v 个 90°；「北」字跟着地图转
    this.mm.style.transform = `rotate(${-90 * v}deg)`;
    this.north.dataset.view = String(v);
  }

  private showLast(l: ChatLine | null, unread: number): void {
    const last = this.chatBtn.querySelector('.last')!;
    last.textContent = l ? `${l.name}：${l.text}` : '说点什么…';
    this.chatBtn.querySelector('.unread')?.remove();
    if (unread) this.chatBtn.append(el('span', 'unread', unread > 99 ? '99+' : String(unread)));
  }

  private drawMinimap(base: HTMLCanvasElement): void {
    const c = this.mm.getContext('2d')!;
    const dots = this.world.dots();
    const self = dots.find((d) => d.self);
    if (!self) return;
    const x0 = Math.round(self.x / TILE) - MINIMAP_SPAN / 2, y0 = Math.round(self.y / TILE) - MINIMAP_SPAN / 2;
    c.fillStyle = '#8fd18b';
    c.fillRect(0, 0, MINIMAP_SPAN, MINIMAP_SPAN);
    c.drawImage(base, -x0, -y0);
    const dest = this.world.destination();
    if (dest) {
      c.fillStyle = '#ffb627';
      c.fillRect(Math.round(dest.x / TILE) - x0 - 1, Math.round(dest.y / TILE) - y0 - 1, 3, 3);
    }
    for (const d of dots) {
      const x = Math.round(d.x / TILE) - x0, y = Math.round(d.y / TILE) - y0;
      c.fillStyle = '#2a2433';
      c.fillRect(x - (d.self ? 2 : 1), y - (d.self ? 2 : 1), d.self ? 5 : 3, d.self ? 5 : 3);
      c.fillStyle = d.self ? '#ffb627' : '#ffffff';
      c.fillRect(x - (d.self ? 1 : 0), y - (d.self ? 1 : 0), d.self ? 3 : 1, d.self ? 3 : 1);
    }
  }

  /** 触屏摇杆：按住拖动，松手停下 */
  private joystick(): HTMLElement {
    const base = el('div', 'stick');
    const knob = el('i');
    base.append(knob);
    base.setAttribute('aria-hidden', 'true');
    let id = -1;
    const move = (e: PointerEvent) => {
      const r = base.getBoundingClientRect();
      const R = r.width / 2;
      let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
      const d = Math.hypot(dx, dy);
      if (d > R) (dx *= R / d), (dy *= R / d);
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // 中心一小圈是死区，免得手指轻抖就走
      const m = Math.hypot(dx, dy) / R;
      this.actions.stick(m < 0.15 ? 0 : dx / R, m < 0.15 ? 0 : dy / R);
    };
    base.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      id = e.pointerId;
      base.setPointerCapture(id);
      move(e);
    });
    base.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      knob.style.transform = '';
      this.actions.stick(0, 0);
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
    return base;
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!Sheet.closeAll()) this.atlas.hide();
        return;
      }
      if (typing()) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.chat.open();
      }
      if (e.key === 'm' || e.key === 'M') this.atlas.toggle();
      if ((e.key === 'r' || e.key === 'R') && !this.rideBtn.classList.contains('hidden')) this.actions.ride();
      if (e.key === '-' || e.key === '_') this.actions.zoom(-1);
      if (e.key === '=' || e.key === '+') this.actions.zoom(1);
    });
  }

  get currentPoi(): Poi | null {
    return this.poi;
  }
}
