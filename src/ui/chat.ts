// 聊天面板：附近、广场和几个讨论室，每个频道一个标签页。消息一律按纯文本显示。
// 点发言人的名字可以举报这条消息或拉黑对方。访客能看不能说，输入框换成登录按钮。
import { CHAT, DISCUSS, cleanText, type Channel, type ChatLine } from '../../shared/social.ts';
import { account } from '../account.ts';
import { button, el, hhmm, Sheet, toast } from './dom.ts';

export interface ChatDeps {
  send(ch: Channel, text: string): void;
  history(ch: Channel): void;
  report(id: number): void;
  block(uid: number, on: boolean): void;
  /** 自己在本房间的 sessionId */
  sid(): string;
  login(): void;
}

const TABS: { ch: Channel; name: string }[] = [
  { ch: 'near', name: '附近' },
  { ch: 'square', name: '广场' },
  ...DISCUSS.map((d) => ({ ch: `room:${d.id}` as Channel, name: d.name })),
];

/** 每个频道在内存里最多留多少条 */
const KEEP = 200;

export class ChatPanel {
  readonly sheet = new Sheet('聊天', { tall: true });
  private readonly deps: ChatDeps;
  private ch: Channel = 'near';
  private readonly lines = new Map<Channel, ChatLine[]>();
  private readonly unread = new Map<Channel, number>();
  private readonly loaded = new Set<Channel>();
  private readonly tabEls = new Map<Channel, HTMLButtonElement>();
  private readonly list = el('div', 'lines');
  private readonly input = el('input', 'field');
  private readonly compose = el('div', 'compose');
  private menu: HTMLElement | null = null;
  /** 最新一条消息，底栏上显示 */
  onLast?: (line: ChatLine | null, unread: number) => void;

  constructor(deps: ChatDeps) {
    this.deps = deps;
    const root = el('div', 'chat');
    const tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    for (const t of TABS) {
      const b = el('button', 'tab', t.name);
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.switchTo(t.ch));
      tabs.append(b);
      this.tabEls.set(t.ch, b);
    }
    this.list.setAttribute('aria-live', 'polite');
    this.input.maxLength = CHAT.max * 2;
    this.input.enterKeyHint = 'send';
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) this.submit();
      if (e.key === 'Escape') this.sheet.close();
    });
    root.append(tabs, this.list, this.compose);
    this.sheet.body.replaceWith(root);
    this.sheet.onClose = () => {
      this.closeMenu();
      this.input.blur();
    };
    this.refreshCompose();
    this.switchTo('near');
  }

  /** 打开面板，ch 给了就切过去 */
  open(ch?: Channel): void {
    this.sheet.show();
    if (ch) this.switchTo(ch);
    else this.render();
    // 手机上自动聚焦会弹出键盘遮住一半屏幕，只在桌面聚焦
    if (account.me && matchMedia('(pointer: fine)').matches) this.input.focus();
  }

  /** 换账号、重连之后：历史要重新拉，输入区按登录状态重画 */
  reset(): void {
    this.loaded.clear();
    this.refreshCompose();
    if (this.sheet.open && this.ch !== 'near') this.loadHistory(this.ch);
  }

  receive(line: ChatLine): void {
    if (account.blocks.has(line.uid)) return;
    this.push(line.ch, line);
    if (!(this.sheet.open && this.ch === line.ch) && line.sid !== this.deps.sid()) this.unread.set(line.ch, (this.unread.get(line.ch) ?? 0) + 1);
    if (this.sheet.open && this.ch === line.ch) this.appendLine(line, true);
    this.updateTabs();
    this.emitLast(line);
  }

  history(ch: Channel, lines: ChatLine[]): void {
    // 历史和已经收到的新消息合并，按编号去重
    const have = this.lines.get(ch) ?? [];
    const seen = new Set(lines.map((l) => l.id));
    this.lines.set(ch, [...lines, ...have.filter((l) => !seen.has(l.id))].slice(-KEEP));
    if (this.ch === ch) this.render();
  }

  /** 服务端的提示（被拒绝的原因等）显示在当前频道里 */
  system(text: string): void {
    if (this.sheet.open) {
      const d = el('div', 'line-sys', text);
      this.list.append(d);
      this.list.scrollTop = this.list.scrollHeight;
    } else toast(text);
  }

  private push(ch: Channel, line: ChatLine): void {
    const arr = this.lines.get(ch) ?? [];
    arr.push(line);
    if (arr.length > KEEP) arr.shift();
    this.lines.set(ch, arr);
  }

  private switchTo(ch: Channel): void {
    this.ch = ch;
    this.unread.delete(ch);
    this.closeMenu();
    if (ch !== 'near' && !this.loaded.has(ch)) this.loadHistory(ch);
    this.render();
    this.refreshCompose();
    this.updateTabs();
    this.emitLast(null);
  }

  private loadHistory(ch: Channel): void {
    this.loaded.add(ch);
    this.deps.history(ch);
  }

  private updateTabs(): void {
    for (const t of TABS) {
      const b = this.tabEls.get(t.ch)!;
      b.classList.toggle('on', t.ch === this.ch);
      b.setAttribute('aria-selected', String(t.ch === this.ch));
      b.textContent = t.name;
      const n = this.unread.get(t.ch);
      if (n) b.append(el('span', 'n', n > 99 ? '99+' : String(n)));
    }
  }

  private totalUnread(): number {
    let n = 0;
    for (const v of this.unread.values()) n += v;
    return n;
  }

  private emitLast(line: ChatLine | null): void {
    const all = line ?? [...this.lines.values()].flat().sort((a, b) => b.t - a.t)[0] ?? null;
    this.onLast?.(all, this.totalUnread());
  }

  private render(): void {
    this.list.replaceChildren();
    const arr = this.lines.get(this.ch) ?? [];
    if (!arr.length) {
      const tip =
        this.ch === 'near'
          ? '附近频道：40 米内的人能看到，消息会出现在头顶。'
          : this.ch === 'square'
            ? '广场：所有平行校园的人都能看到。'
            : `「${TABS.find((t) => t.ch === this.ch)?.name}」讨论室，所有人都能看到。`;
      this.list.append(el('div', 'line-sys', tip));
    }
    for (const l of arr) this.appendLine(l, false);
    this.list.scrollTop = this.list.scrollHeight;
  }

  private appendLine(l: ChatLine, scroll: boolean): void {
    const atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40;
    const mine = !!account.me && l.uid === account.me.id;
    const d = el('div', mine ? 'line-msg me' : 'line-msg');
    const who = el('span', 'who', l.name);
    if (!mine) who.addEventListener('click', (e) => this.openMenu(l, e));
    d.append(el('span', 't', hhmm(l.t)), who, document.createTextNode('：' + l.text));
    this.list.append(d);
    if (scroll && atBottom) this.list.scrollTop = this.list.scrollHeight;
  }

  private refreshCompose(): void {
    this.compose.replaceChildren();
    if (!account.me) {
      this.compose.append(el('span', 'fine', '访客只能看，登录后才能发言'), button('登录', 'primary small', () => this.deps.login(), 'login'));
      this.compose.style.alignItems = 'center';
      this.compose.style.justifyContent = 'space-between';
      return;
    }
    this.compose.removeAttribute('style');
    const newbie = Date.now() - account.me.created < CHAT.newbie && this.ch !== 'near';
    this.input.placeholder = newbie ? '注册满 10 分钟后可以在这里发言' : `说点什么（最多 ${CHAT.max} 字）`;
    this.compose.append(this.input, button('', 'primary icon', () => this.submit(), 'send'));
  }

  private submit(): void {
    const text = cleanText(this.input.value);
    if (!text) return;
    this.deps.send(this.ch, text);
    this.input.value = '';
  }

  private openMenu(l: ChatLine, e: MouseEvent): void {
    this.closeMenu();
    if (!account.me) return;
    const m = el('div', 'who-menu box');
    const blocked = account.blocks.has(l.uid);
    m.append(
      button('举报这条消息', 'small', () => {
        this.deps.report(l.id);
        this.closeMenu();
      }, 'report'),
      button(blocked ? '取消拉黑' : `拉黑 ${l.name}`, 'small', () => {
        this.deps.block(l.uid, !blocked);
        if (blocked) account.blocks.delete(l.uid);
        else {
          account.blocks.add(l.uid);
          for (const [ch, arr] of this.lines) this.lines.set(ch, arr.filter((x) => x.uid !== l.uid));
          this.render();
        }
        this.closeMenu();
      }, 'block'),
    );
    const box = this.sheet.el.getBoundingClientRect();
    m.style.left = `${Math.min(e.clientX - box.left, box.width - 170)}px`;
    m.style.top = `${e.clientY - box.top + 8}px`;
    this.sheet.el.append(m);
    this.menu = m;
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }
}
