// 界面的基本部件：建元素、像素图标、按钮、提示、面板（竖屏是底部抽屉，横屏和桌面是侧栏，由 CSS 决定）。
import type { IconName } from '../../shared/icons.ts';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 图集 ui.json 里每个图标的位置；boot 时载入 */
let iconAt: Record<string, { x: number; y: number }> = {};
export async function loadIcons(): Promise<void> {
  iconAt = await fetch('ui.json').then((r) => r.json());
}

/** 像素图标，scale 是 1 或 2 */
export function icon(name: IconName, scale: 1 | 2 = 1): HTMLElement {
  const i = el('i', scale === 2 ? 'ic x2' : 'ic');
  setIcon(i, name);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

export function setIcon(i: HTMLElement, name: IconName): void {
  const p = iconAt[name];
  const s = i.classList.contains('x2') ? 2 : 1;
  if (p) i.style.backgroundPosition = `${-p.x * s}px ${-p.y * s}px`;
}

export function button(label: string, cls = '', onClick?: (e: MouseEvent) => void, ic?: IconName): HTMLButtonElement {
  const b = el('button', `btn ${cls}`.trim());
  if (ic) b.append(icon(ic));
  if (label) b.append(document.createTextNode(label));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** 只有图标的按钮：tip 同时做悬停提示和读屏文字 */
export function iconButton(ic: IconName, tip: string, onClick: () => void, cls = 'icon'): HTMLButtonElement {
  const b = el('button', `btn ${cls}`);
  b.append(icon(ic));
  b.title = tip;
  b.setAttribute('aria-label', tip);
  b.addEventListener('click', onClick);
  return b;
}

let toastEl: HTMLElement | null = null;
let toastTimer = 0;
export function toast(msg: string, ms = 3000): void {
  if (!toastEl) {
    toastEl = el('div', 'toast hidden');
    toastEl.setAttribute('role', 'status');
    document.getElementById('ui')!.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl!.classList.add('hidden'), ms);
}

/** 面板：同一时刻只开一个，开新的会关掉旧的 */
export class Sheet {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  readonly head: HTMLElement;
  private readonly title: HTMLElement;
  private readonly scrim: HTMLElement;
  onClose?: () => void;
  private static current: Sheet | null = null;

  constructor(title: string, opts: { tall?: boolean; back?: () => void } = {}) {
    this.el = el('section', opts.tall ? 'sheet tall' : 'sheet');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', title);
    this.head = el('div', 'sheet-head');
    this.title = el('h2', '', title);
    if (opts.back) this.head.append(iconButton('back', '返回', opts.back, 'ghost icon'));
    this.head.append(this.title, iconButton('close', '关闭（Esc）', () => this.close(), 'ghost icon'));
    this.body = el('div', 'sheet-body');
    this.el.append(this.head, this.body);
    this.scrim = el('div', 'scrim');
    this.scrim.addEventListener('pointerdown', () => this.close());
    // 面板里的触摸和滚轮不传给游戏画面
    for (const t of ['pointerdown', 'wheel', 'touchstart'] as const) this.el.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
  }

  setTitle(t: string): void {
    this.title.textContent = t;
  }

  get open(): boolean {
    return Sheet.current === this;
  }

  show(): this {
    if (Sheet.current && Sheet.current !== this) Sheet.current.close();
    Sheet.current = this;
    const ui = document.getElementById('ui')!;
    ui.append(this.scrim, this.el);
    return this;
  }

  close(): void {
    if (Sheet.current !== this) return;
    Sheet.current = null;
    this.el.remove();
    this.scrim.remove();
    this.onClose?.();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  static closeAll(): boolean {
    if (!Sheet.current) return false;
    Sheet.current.close();
    return true;
  }
}

/** 正在往输入框里打字（这时不响应游戏快捷键） */
export function typing(): boolean {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement;
}

/** 复制文字到剪贴板，失败时返回 false */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = el('textarea');
    t.value = text;
    document.body.append(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** 北京时间 HH:MM */
export function hhmm(t: number | Date): string {
  return new Date(t).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
}
