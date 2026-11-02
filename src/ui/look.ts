// 角色预览和形象编辑器：把 avatar.png 的分层精灵按颜色乘色后叠起来画在 canvas 上。
import { AVATAR, AVATAR_PARTS, BODY, BOTTOM_COLOR, BOTTOM_STYLE, HAIR_COLOR, HAIR_STYLE, NAME_MAX, SKIN, TOP_COLOR, TOP_STYLE, avatarFrame, tintOf, type Look } from '../../shared/social.ts';
import { el, hex } from './dom.ts';

let avatarImg: HTMLImageElement | null = null;
export function loadAvatarImage(): Promise<HTMLImageElement | null> {
  if (avatarImg) return Promise.resolve(avatarImg);
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res((avatarImg = img));
    img.onerror = () => res(null);
    img.src = 'avatar.png';
  });
}

export function drawPreview(canvas: HTMLCanvasElement, look: Look, dir = 0): void {
  const img = avatarImg;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!img) return;
  const { w, h } = AVATAR;
  const per = img.width / w;
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const t = tmp.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (const p of AVATAR_PARTS) {
    const frame = avatarFrame(p.block(look), dir, AVATAR.idle);
    const color = p.tint ? tintOf(look, p.tint) : null;
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

export function previewCanvas(look: Look, scale = 2): HTMLCanvasElement {
  const c = el('canvas');
  c.width = AVATAR.w * scale;
  c.height = AVATAR.h * scale;
  drawPreview(c, look);
  return c;
}

/** 昵称输入和外观选择；value() 取当前结果 */
export function lookEditor(name: string, look0: Look): { el: HTMLElement; value(): { name: string; look: Look }; focus(): void } {
  const look = { ...look0 };
  const root = el('div', 'editor');
  const preview = el('canvas', 'preview');
  preview.width = AVATAR.w * 4;
  preview.height = AVATAR.h * 4;
  let dir = 0;
  const redraw = () => drawPreview(preview, look, dir);
  preview.title = '点一下转身';
  preview.addEventListener('click', () => ((dir = (dir + 1) % 4), redraw()));

  const form = el('div', 'editor-form');
  const input = el('input', 'field');
  input.maxLength = NAME_MAX * 2;
  input.placeholder = '昵称（最多 12 个字）';
  input.value = name;
  input.setAttribute('aria-label', '昵称');
  form.append(input);

  const picker = (label: string, count: number, get: () => number, set: (i: number) => void, swatch?: (i: number) => string, text?: (i: number) => string) => {
    const row = el('div', 'pick');
    row.append(el('span', 'pick-label', label));
    const opts = el('div', 'pick-opts');
    const buttons: HTMLButtonElement[] = [];
    for (let i = 0; i < count; i++) {
      const b = el('button', text ? 'opt opt-text' : 'opt');
      if (text) b.textContent = text(i);
      else b.style.background = swatch!(i);
      b.setAttribute('aria-label', `${label} ${text ? text(i) : i + 1}`);
      b.addEventListener('click', () => {
        set(i);
        buttons.forEach((x, j) => x.classList.toggle('on', j === i));
        redraw();
      });
      b.classList.toggle('on', i === get());
      buttons.push(b);
      opts.append(b);
    }
    row.append(opts);
    form.append(row);
  };
  picker('体型', BODY.length, () => look.body, (i) => (look.body = i), undefined, (i) => BODY[i]);
  picker('肤色', SKIN.length, () => look.skin, (i) => (look.skin = i), (i) => hex(SKIN[i]));
  picker('发型', HAIR_STYLE.length, () => look.hair, (i) => (look.hair = i), undefined, (i) => HAIR_STYLE[i]);
  picker('发色', HAIR_COLOR.length, () => look.hairColor, (i) => (look.hairColor = i), (i) => hex(HAIR_COLOR[i]));
  picker('上衣', TOP_STYLE.length, () => look.topStyle, (i) => (look.topStyle = i), undefined, (i) => TOP_STYLE[i]);
  picker('上衣色', TOP_COLOR.length, () => look.top, (i) => (look.top = i), (i) => hex(TOP_COLOR[i]));
  picker('下装', BOTTOM_STYLE.length, () => look.bottomStyle, (i) => (look.bottomStyle = i), undefined, (i) => BOTTOM_STYLE[i]);
  picker('下装色', BOTTOM_COLOR.length, () => look.bottom, (i) => (look.bottom = i), (i) => hex(BOTTOM_COLOR[i]));
  root.append(preview, form);
  void loadAvatarImage().then(redraw);
  return { el: root, value: () => ({ name: input.value, look: { ...look } }), focus: () => input.focus() };
}
