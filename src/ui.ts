// 网页界面层（DOM）：进入面板、底部表情与短语栏、地标卡片、小地图、提示。
// 游戏画面只管世界，界面元素都在这里，方便改样式和做无障碍。
import { BODY, BOTTOM_COLOR, BOTTOM_STYLE, EMOTES, HAIR_COLOR, HAIR_STYLE, NAME_MAX, PHRASES, SKIN, TOP_COLOR, TOP_STYLE, AVATAR, AVATAR_PARTS, DEFAULT_LOOK, avatarFrame, cleanLook, cleanName, tintOf, type Look } from '../shared/social.ts';
import { TILE } from '../shared/world.ts';
import { Atlas, type AtlasSource } from './atlas.ts';
import type { Poi } from './scene.ts';

const STORE_KEY = 'pixel-neu:profile';
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
};
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 本机记住的昵称和外观；读写失败（隐私模式等）时退回默认值 */
export function loadProfile(): { name: string; look: Look } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (raw) return { name: cleanName(raw.name), look: cleanLook(raw.look) };
  } catch {
    /* 读不到就用默认 */
  }
  return { name: '', look: { ...DEFAULT_LOOK, top: Math.floor(Math.random() * TOP_COLOR.length) } };
}

function saveProfile(name: string, look: Look): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ name, look }));
  } catch {
    /* 存不了也不影响游玩 */
  }
}

// ---------- 角色预览：把分层精灵按颜色乘色后叠起来 ----------
let avatarImg: HTMLImageElement | null = null;
function loadAvatarImage(): Promise<HTMLImageElement> {
  if (avatarImg) return Promise.resolve(avatarImg);
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res((avatarImg = img));
    img.onerror = rej;
    img.src = 'avatar.png';
  });
}

function drawPreview(canvas: HTMLCanvasElement, look: Look, dir = 0): void {
  const img = avatarImg;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!img) return;
  const { w, h } = AVATAR;
  const parts = AVATAR_PARTS.map((p) => [avatarFrame(p.block(look), dir, AVATAR.idle), p.tint ? tintOf(look, p.tint) : null] as const);
  const per = img.width / w;
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const t = tmp.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (const [frame, color] of parts) {
    const sx = (frame % per) * w, sy = Math.floor(frame / per) * h;
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, w, h);
    t.drawImage(img, sx, sy, w, h, 0, 0, w, h);
    if (color !== null) {
      t.globalCompositeOperation = 'multiply';
      t.fillStyle = hex(color);
      t.fillRect(0, 0, w, h);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(img, sx, sy, w, h, 0, 0, w, h);
    }
    ctx.drawImage(tmp, 0, 0, w, h, 0, 0, canvas.width, canvas.height);
  }
}

// ---------- 进入面板 ----------
export async function showJoin(root: HTMLElement, onJoin: (name: string, look: Look) => Promise<void>): Promise<void> {
  await loadAvatarImage().catch(() => null);
  const profile = loadProfile();
  const look = { ...profile.look };

  const panel = el('div', 'panel join');
  panel.append(el('h1', 'title', '像素东大'), el('p', 'subtitle', 'Pixel NEU · 东北大学南湖校区'));

  const body = el('div', 'join-body');
  const preview = el('canvas', 'preview');
  preview.width = AVATAR.w * 4;
  preview.height = AVATAR.h * 4;
  let dir = 0;
  const redraw = () => drawPreview(preview, look, dir);
  preview.title = '点击转身';
  preview.addEventListener('click', () => ((dir = (dir + 1) % 4), redraw()));

  const form = el('div', 'join-form');
  const nameInput = el('input', 'name');
  nameInput.maxLength = NAME_MAX * 2;
  nameInput.placeholder = '你的昵称';
  nameInput.value = profile.name;
  nameInput.setAttribute('aria-label', '昵称');
  form.append(nameInput);

  const picker = (label: string, count: number, current: () => number, set: (i: number) => void, swatch: (i: number) => string, text?: (i: number) => string) => {
    const row = el('div', 'pick');
    row.append(el('span', 'pick-label', label));
    const opts = el('div', 'pick-opts');
    const buttons: HTMLButtonElement[] = [];
    for (let i = 0; i < count; i++) {
      const b = el('button', text ? 'opt opt-text' : 'opt');
      if (text) b.textContent = text(i);
      else b.style.background = swatch(i);
      b.setAttribute('aria-label', `${label} ${text ? text(i) : i + 1}`);
      b.addEventListener('click', () => {
        set(i);
        buttons.forEach((x, j) => x.classList.toggle('on', j === i));
        redraw();
      });
      b.classList.toggle('on', i === current());
      buttons.push(b);
      opts.append(b);
    }
    row.append(opts);
    form.append(row);
  };
  picker('体型', BODY.length, () => look.body, (i) => (look.body = i), () => '', (i) => BODY[i]);
  picker('肤色', SKIN.length, () => look.skin, (i) => (look.skin = i), (i) => hex(SKIN[i]));
  picker('发型', HAIR_STYLE.length, () => look.hair, (i) => (look.hair = i), () => '', (i) => HAIR_STYLE[i]);
  picker('发色', HAIR_COLOR.length, () => look.hairColor, (i) => (look.hairColor = i), (i) => hex(HAIR_COLOR[i]));
  picker('上衣', TOP_STYLE.length, () => look.topStyle, (i) => (look.topStyle = i), () => '', (i) => TOP_STYLE[i]);
  picker('上衣色', TOP_COLOR.length, () => look.top, (i) => (look.top = i), (i) => hex(TOP_COLOR[i]));
  picker('下装', BOTTOM_STYLE.length, () => look.bottomStyle, (i) => (look.bottomStyle = i), () => '', (i) => BOTTOM_STYLE[i]);
  picker('下装色', BOTTOM_COLOR.length, () => look.bottom, (i) => (look.bottom = i), (i) => hex(BOTTOM_COLOR[i]));

  body.append(preview, form);
  const go = el('button', 'go', '进入校园');
  const err = el('p', 'error');
  const foot = el('p', 'credit', '谜团 mituan 开发 · 非官方作品');
  panel.append(body, go, err, foot);
  root.append(panel);
  redraw();
  nameInput.focus();

  const submit = async () => {
    const name = cleanName(nameInput.value);
    go.disabled = true;
    go.textContent = '连接中…';
    err.textContent = '';
    try {
      await onJoin(name, look);
      saveProfile(name, look);
      panel.remove();
    } catch (e) {
      console.error(e);
      err.textContent = '连不上服务器，请稍后再试。';
      go.disabled = false;
      go.textContent = '进入校园';
    }
  };
  go.addEventListener('click', submit);
  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
}

// ---------- 游戏中的界面 ----------
export interface Hud {
  setCount(n: number, room: string): void;
  setPoi(p: Poi | null): void;
  toast(msg: string): void;
  /** 视角变了：小地图跟着转 */
  setView(v: number): void;
  setZoom(z: number): void;
}

export interface HudActions {
  emote(i: number): void;
  say(i: number): void;
  rotate(step: number): void;
  zoom(step: number): void;
  walkTo(x: number, y: number): boolean;
}

export interface HudWorld extends AtlasSource {
  size: { w: number; h: number };
  zoom: number;
}

/** 帮助面板里的操作说明：按键、做什么 */
const HELP: [string, string][] = [
  ['WASD / 方向键', '走路'],
  ['点击地面', '走过去'],
  ['滚轮 / － ＋', '缩放画面'],
  ['Q / E', '转视角'],
  ['M / 点小地图', '打开全图，点地方就走过去'],
  ['1–6', '表情'],
  ['T', '快捷短语'],
  ['H', '显示 / 隐藏这份说明'],
];

export function showHud(root: HTMLElement, actions: HudActions, world: HudWorld): Hud {
  // 左上：地点和在线人数
  const top = el('div', 'hud-top');
  const place = el('div', 'place', '东北大学 · 南湖校区');
  const count = el('div', 'count');
  top.append(place, count);
  if (import.meta.env.DEV) top.append(el('div', 'dev-badge', '开发者模式 · 按住 Shift 加速 5 倍'));

  // 底栏：表情按钮 + 短语菜单
  const bar = el('div', 'bar');
  EMOTES.forEach((name, i) => {
    const b = el('button', 'emote');
    b.style.backgroundImage = 'url(emotes.png)';
    b.style.backgroundPosition = `${-i * 36}px 0`;
    b.title = `${name}（${i + 1}）`;
    b.setAttribute('aria-label', name);
    b.addEventListener('click', () => actions.emote(i));
    bar.append(b);
  });
  const sayBtn = el('button', 'say', '说…');
  sayBtn.title = '快捷短语（T）';
  const menu = el('div', 'phrases hidden');
  PHRASES.forEach((p, i) => {
    const b = el('button', 'phrase', p);
    b.addEventListener('click', () => {
      actions.say(i);
      menu.classList.add('hidden');
    });
    menu.append(b);
  });
  sayBtn.addEventListener('click', () => menu.classList.toggle('hidden'));
  bar.append(sayBtn);

  const card = el('div', 'card hidden');
  const cardTitle = el('h2'), cardText = el('p'), cardSrc = el('p', 'src');
  card.append(cardTitle, cardText, cardSrc);
  const toastEl = el('div', 'toast hidden');
  let toastTimer = 0;
  const toast = (msg: string) => {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), 3000);
  };

  // 整张地图画在 mmBase 上（每格一像素），小地图和全图共用
  const mmBase = document.createElement('canvas');
  mmBase.width = world.size.w;
  mmBase.height = world.size.h;
  buildMinimapBase(mmBase);
  const atlas = new Atlas(mmBase, world, { walkTo: actions.walkTo, toast });

  // 右上：小地图（按世界上北画，再随视角整体转），下面一排工具按钮
  const dock = el('div', 'dock');
  const mmBox = el('div', 'minimap-box');
  const mm = el('canvas', 'minimap');
  const north = el('div', 'north', '北');
  mmBox.append(mm, north);
  mmBox.title = '打开全图（M）';
  mmBox.addEventListener('click', () => atlas.show());
  const tools = el('div', 'tools');
  const tool = (label: string, tip: string, fn: () => void, cls = 'icon-btn') => {
    const b = el('button', cls, label);
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.addEventListener('click', fn);
    tools.append(b);
    return b;
  };
  tool('－', '缩小（滚轮 / -）', () => actions.zoom(-1));
  const zoomLabel = tool('', '当前缩放倍数', () => undefined, 'icon-btn zoom-label');
  zoomLabel.disabled = true;
  tool('＋', '放大（滚轮 / +）', () => actions.zoom(1));
  tool('⟲', '向左转视角（Q）', () => actions.rotate(-1));
  tool('⟳', '向右转视角（E）', () => actions.rotate(1));
  tool('▦', '全图（M）', () => atlas.toggle());
  tool('?', '操作说明（H）', () => help.classList.toggle('hidden'));
  dock.append(mmBox, tools);

  mm.width = mm.height = MINIMAP_SPAN;
  const drawMinimap = () => {
    const c = mm.getContext('2d')!;
    const dots = world.dots();
    const self = dots.find((d) => d.self);
    if (!self) return;
    const x0 = Math.round(self.x / TILE) - MINIMAP_SPAN / 2, y0 = Math.round(self.y / TILE) - MINIMAP_SPAN / 2;
    c.fillStyle = '#2a2433';
    c.fillRect(0, 0, MINIMAP_SPAN, MINIMAP_SPAN);
    c.drawImage(mmBase, -x0, -y0);
    const dest = world.destination();
    if (dest) {
      c.fillStyle = '#f0c94a';
      c.fillRect(Math.round(dest.x / TILE) - x0 - 1, Math.round(dest.y / TILE) - y0 - 1, 3, 3);
    }
    for (const d of dots) {
      c.fillStyle = d.self ? '#2a2433' : '#ffffff';
      c.fillRect(Math.round(d.x / TILE) - x0 - (d.self ? 2 : 1), Math.round(d.y / TILE) - y0 - (d.self ? 2 : 1), d.self ? 5 : 3, d.self ? 5 : 3);
      if (d.self) (c.fillStyle = '#f0c94a'), c.fillRect(Math.round(d.x / TILE) - x0 - 1, Math.round(d.y / TILE) - y0 - 1, 3, 3);
    }
  };
  setInterval(drawMinimap, 250);

  // 操作说明：第一次进来时展开，之后记住是否收起
  const help = el('div', 'help');
  help.append(el('div', 'help-title', '操作说明'));
  for (const [key, what] of HELP) {
    const row = el('div', 'help-row');
    row.append(el('span', 'help-key', key), el('span', 'help-what', what));
    help.append(row);
  }
  const helpClose = el('button', 'icon-btn help-close', '✕');
  helpClose.title = '收起（H）';
  helpClose.addEventListener('click', () => help.classList.add('hidden'));
  help.append(helpClose);
  if (seenHelp()) help.classList.add('hidden');
  else markHelpSeen();

  const credit = el('div', 'attribution', '地图数据 © OpenStreetMap 贡献者 · 谜团 mituan · 非官方作品');
  root.append(top, bar, menu, card, dock, help, credit, toastEl, atlas.el);

  window.addEventListener('keydown', (e) => {
    if (document.activeElement instanceof HTMLInputElement) return;
    const n = Number(e.key);
    if (n >= 1 && n <= EMOTES.length) actions.emote(n - 1);
    if (e.key === 't' || e.key === 'T') menu.classList.toggle('hidden');
    if (e.key === 'm' || e.key === 'M') atlas.toggle();
    if (e.key === 'h' || e.key === 'H') help.classList.toggle('hidden');
    if (e.key === '-' || e.key === '_') actions.zoom(-1);
    if (e.key === '=' || e.key === '+') actions.zoom(1);
    if (e.key === 'Escape') {
      menu.classList.add('hidden');
      help.classList.add('hidden');
      atlas.hide();
    }
  });

  const hud: Hud = {
    setCount(n, room) {
      count.textContent = `在线 ${n} 人 · 平行校园 ${room.slice(0, 4)}`;
    },
    setPoi(p) {
      card.classList.toggle('hidden', !p);
      if (!p) return;
      cardTitle.textContent = p.name;
      cardText.textContent = p.text;
      const src = p.src.split(',').map((s) => SOURCE_LABEL[s.trim()] ?? s).filter(Boolean);
      cardSrc.textContent = src.length ? `资料：${src.join('、')}` : '';
    },
    setView(v) {
      // 视角 v 是屏幕上方的地理方向，地图要逆时针转 v 个 90°；「北」字跟着地图转
      mm.style.transform = `rotate(${-90 * v}deg)`;
      north.dataset.view = String(v);
    },
    setZoom(z) {
      zoomLabel.textContent = `${z}×`;
    },
    toast,
  };
  hud.setZoom(world.zoom);
  return hud;
}

const HELP_KEY = 'pixel-neu:help-seen';
function seenHelp(): boolean {
  try {
    return localStorage.getItem(HELP_KEY) === '1';
  } catch {
    return false;
  }
}
function markHelpSeen(): void {
  try {
    localStorage.setItem(HELP_KEY, '1');
  } catch {
    /* 存不了下次再展开一次 */
  }
}

/** 小地图显示范围（格）：120 格 = 240 m */
const MINIMAP_SPAN = 120;

/** 小地图底图：从 tiles.png 每格取中心像素的颜色，按地图 ground 图层铺开，再叠上建筑占地 */

function buildMinimapBase(canvas: HTMLCanvasElement): void {
  void Promise.all([fetch('map.json').then((r) => r.json()), new Promise<HTMLImageElement>((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.src = 'tiles.png';
  })]).then(([map, img]) => {
    const t = document.createElement('canvas');
    t.width = img.width;
    t.height = img.height;
    const tc = t.getContext('2d')!;
    tc.drawImage(img, 0, 0);
    const cols = img.width / TILE;
    const ctx = canvas.getContext('2d')!;
    const out = ctx.createImageData(canvas.width, canvas.height);
    const ground = map.layers.find((l: { name: string }) => l.name === 'ground').data as number[];
    const cache = new Map<number, Uint8ClampedArray>();
    ground.forEach((g, i) => {
      if (!cache.has(g)) {
        const k = g - 1;
        cache.set(g, tc.getImageData((k % cols) * TILE + 8, Math.floor(k / cols) * TILE + 8, 1, 1).data);
      }
      out.data.set(cache.get(g)!, i * 4);
    });
    ctx.putImageData(out, 0, 0);
    ctx.fillStyle = '#93989a';
    for (const o of map.layers.find((l: { name: string }) => l.name === 'objects').objects)
      if (o.type === 'building') {
        const rows = (o.properties.find((p: { name: string }) => p.name === 'mask').value as string).split('/');
        rows.forEach((row, r) => [...row].forEach((ch, c) => ch !== '0' && ctx.fillRect(o.x / TILE + c, o.y / TILE + r, 1, 1)));
      }
  });
}
