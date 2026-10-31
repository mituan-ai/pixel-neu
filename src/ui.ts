// 网页界面层（DOM）：进入面板、底部表情与短语栏、地标卡片、小地图、提示。
// 游戏画面只管世界，界面元素都在这里，方便改样式和做无障碍。
import { BOTTOM_COLOR, EMOTES, HAIR_COLOR, HAIR_STYLE, NAME_MAX, PHRASES, SKIN, TOP_COLOR, AVATAR, DEFAULT_LOOK, cleanLook, cleanName, type Look } from '../shared/social.ts';
import { TILE } from '../shared/world.ts';
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
};
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
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
  const { w, h, rows } = AVATAR;
  const parts: [number, number | null][] = [
    [rows.skin + dir, SKIN[look.skin]],
    [rows.bottom + dir, BOTTOM_COLOR[look.bottom]],
    [rows.top + dir, TOP_COLOR[look.top]],
    [rows.detail + dir, null],
    [rows.hair + look.hair * 4 + dir, HAIR_COLOR[look.hairColor]],
  ];
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const t = tmp.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (const [row, color] of parts) {
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, w, h);
    t.drawImage(img, 0, row * h, w, h, 0, 0, w, h);
    if (color !== null) {
      t.globalCompositeOperation = 'multiply';
      t.fillStyle = hex(color);
      t.fillRect(0, 0, w, h);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(img, 0, row * h, w, h, 0, 0, w, h);
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
  preview.width = AVATAR.w * 5;
  preview.height = AVATAR.h * 5;
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
  picker('肤色', SKIN.length, () => look.skin, (i) => (look.skin = i), (i) => hex(SKIN[i]));
  picker('发型', HAIR_STYLE.length, () => look.hair, (i) => (look.hair = i), () => '', (i) => HAIR_STYLE[i]);
  picker('发色', HAIR_COLOR.length, () => look.hairColor, (i) => (look.hairColor = i), (i) => hex(HAIR_COLOR[i]));
  picker('上衣', TOP_COLOR.length, () => look.top, (i) => (look.top = i), (i) => hex(TOP_COLOR[i]));
  picker('下装', BOTTOM_COLOR.length, () => look.bottom, (i) => (look.bottom = i), (i) => hex(BOTTOM_COLOR[i]));

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
}

export function showHud(
  root: HTMLElement,
  actions: { emote(i: number): void; say(i: number): void },
  minimap: { size: { w: number; h: number }; dots(): { x: number; y: number; self: boolean }[] },
): Hud {
  const top = el('div', 'hud-top');
  const place = el('span', 'place', '南湖校区 · 北门—图书馆');
  const count = el('span', 'count');
  top.append(place, count);

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

  // 小地图：地面颜色取自瓦片，玩家是小点；屏幕上方为南
  const mm = el('canvas', 'minimap');
  mm.width = minimap.size.w;
  mm.height = minimap.size.h;
  mm.title = '小地图（M）';
  const mmBase = document.createElement('canvas');
  mmBase.width = mm.width;
  mmBase.height = mm.height;
  buildMinimapBase(mmBase);
  const drawMinimap = () => {
    const c = mm.getContext('2d')!;
    c.drawImage(mmBase, 0, 0);
    for (const d of minimap.dots()) {
      c.fillStyle = d.self ? '#f0c94a' : '#ffffff';
      c.fillRect(Math.round(d.x / TILE) - 1, Math.round(d.y / TILE) - 1, 3, 3);
    }
  };
  setInterval(drawMinimap, 250);

  const credit = el('div', 'attribution', '地图数据 © OpenStreetMap 贡献者 · 谜团 mituan');
  const toastEl = el('div', 'toast hidden');
  root.append(top, bar, menu, card, mm, credit, toastEl);

  window.addEventListener('keydown', (e) => {
    if (document.activeElement instanceof HTMLInputElement) return;
    const n = Number(e.key);
    if (n >= 1 && n <= EMOTES.length) actions.emote(n - 1);
    if (e.key === 't' || e.key === 'T') menu.classList.toggle('hidden');
    if (e.key === 'm' || e.key === 'M') mm.classList.toggle('hidden');
    if (e.key === 'Escape') menu.classList.add('hidden');
  });

  let toastTimer = 0;
  return {
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
    toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), 4000);
    },
  };
}

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
