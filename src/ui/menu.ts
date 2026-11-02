// 菜单：我的资料 / 登录、设置、操作说明、加入社群、分享、关于、用户协议、隐私政策。
import type { IconName } from '../../shared/icons.ts';
import { account } from '../account.ts';
import { COMMUNITY, shareUrl } from '../config.ts';
import { ABOUT, HELP, PRIVACY, TERMS, type Doc } from '../legal.ts';
import { settings } from '../settings.ts';
import { button, copyText, el, icon, Sheet, toast } from './dom.ts';
import { previewCanvas } from './look.ts';

export interface MenuDeps {
  login(): void;
  profile(): void;
  logout(): Promise<void>;
  /** 生成分享海报（当前画面截图），返回 data URL */
  poster(): Promise<string>;
}

const isWeChat = () => /MicroMessenger/i.test(navigator.userAgent);

export class Menu {
  private readonly deps: MenuDeps;
  readonly sheet = new Sheet('菜单');

  constructor(deps: MenuDeps) {
    this.deps = deps;
  }

  open(): void {
    this.sheet.setTitle('菜单');
    const b = this.sheet.body;
    b.replaceChildren();
    const me = account.me;
    const row = el('div', 'me-row');
    if (me) {
      const who = el('div', 'who');
      who.append(el('b', '', me.name), el('span', 'fine', `编号 ${me.id}`));
      row.append(previewCanvas(me.look), who, button('改资料', 'small', () => this.deps.profile()));
    } else {
      const who = el('div', 'who');
      who.append(el('b', '', '访客'), el('span', 'fine', '别人看不到你，登录后才能聊天'));
      row.append(previewCanvas(account.guestLook()), who, button('登录', 'primary small', () => this.deps.login(), 'login'));
    }
    b.append(row);

    const list = el('div', 'menu-list');
    const item = (label: string, ic: IconName, fn: () => void) => {
      const x = button('', 'menu-item', fn);
      x.append(icon(ic, 2), document.createTextNode(label));
      list.append(x);
    };
    item('设置', 'settings', () => this.settings());
    item('操作说明', 'help', () => this.doc('操作说明', HELP.map(([k, v]) => [k, v])));
    item('加入社群', 'group', () => this.community());
    item('分享', 'share', () => this.share());
    item('关于', 'people', () => this.doc('关于', ABOUT));
    item('用户协议', 'pin', () => this.doc('用户协议', TERMS));
    item('隐私政策', 'block', () => this.doc('隐私政策', PRIVACY));
    if (me)
      item('退出登录', 'logout', async () => {
        this.sheet.close();
        await this.deps.logout();
      });
    b.append(list);
    this.sheet.show();
  }

  private sub(title: string): HTMLElement {
    const s = new Sheet(title, { back: () => this.open() });
    s.show();
    return s.body;
  }

  settings(): void {
    const b = this.sub('设置');
    const seg = (label: string, opts: [string, () => boolean, () => void][]) => {
      const r = el('div', 'row');
      r.append(el('label', '', label));
      const g = el('div', 'seg');
      const btns = opts.map(([t, on, set]) => {
        const x = button(t, 'small', () => {
          set();
          btns.forEach((y, i) => y.classList.toggle('on', opts[i][1]()));
        });
        x.classList.toggle('on', on());
        return x;
      });
      g.append(...btns);
      r.append(g);
      b.append(r);
    };
    seg('画面', [
      ['跟随真实时间', () => settings.value.daylight === 'real', () => settings.set({ daylight: 'real' })],
      ['始终白天', () => settings.value.daylight === 'day', () => settings.set({ daylight: 'day' })],
    ]);
    seg('雨雪', [
      ['显示', () => settings.value.weatherFx, () => settings.set({ weatherFx: true })],
      ['关闭', () => !settings.value.weatherFx, () => settings.set({ weatherFx: false })],
    ]);
    b.append(el('p', 'fine', '跟随真实时间：按沈阳的日出日落变化，夜里路灯和窗户会亮。'));
  }

  doc(title: string, doc: Doc): void {
    const b = this.sub(title);
    if (title === '操作说明') {
      for (const [k, v] of doc) {
        const r = el('div', 'help-row');
        r.append(el('span', 'help-key', k), el('span', '', v));
        b.append(r);
      }
      return;
    }
    for (const [h, ...ps] of doc) {
      b.append(el('h3', '', h));
      let ul: HTMLUListElement | null = null;
      for (const p of ps) {
        if (p.startsWith('· ')) {
          ul ??= b.appendChild(el('ul'));
          ul.append(el('li', '', p.slice(2)));
        } else {
          ul = null;
          b.append(el('p', '', p));
        }
      }
    }
  }

  community(): void {
    const b = this.sub('加入社群');
    b.append(el('p', '', '和同学们一起聊校园、报地图错误、提新点子。'));
    const card = (title: string, lines: HTMLElement[], qr: string) => {
      const c = el('div', 'group-card');
      const q = el('div', 'qr');
      if (qr) {
        const img = el('img');
        img.src = `community/${qr}`;
        img.alt = `${title}二维码`;
        q.append(img);
      } else q.textContent = '二维码\n即将开放';
      const info = el('div');
      info.append(el('h3', '', title), ...lines);
      c.append(q, info);
      b.append(c);
    };
    const qq = COMMUNITY.qq;
    const qqLines: HTMLElement[] = [];
    if (qq.number) {
      qqLines.push(el('p', '', `群号：${qq.number}`));
      const row = el('div', 'row');
      row.append(button('复制群号', 'small', async () => toast((await copyText(qq.number)) ? '群号已复制，去 QQ 里搜索加群' : '复制失败，请手动记下群号')));
      // 微信里打不开 QQ 的链接，只给复制
      if (qq.link && !isWeChat()) row.append(button('打开 QQ 加群', 'small primary', () => (location.href = qq.link)));
      qqLines.push(row);
    } else qqLines.push(el('p', 'fine', '群号即将公布'));
    card('QQ 群', qqLines, qq.qr);

    const wx = COMMUNITY.wechat;
    const wxLines: HTMLElement[] = [el('p', 'fine', '微信群二维码 7 天就过期，请先加管理员，由管理员拉你进群。')];
    if (wx.id) {
      wxLines.unshift(el('p', '', `${wx.label}：${wx.id}`));
      wxLines.push(button('复制微信号', 'small', async () => toast((await copyText(wx.id)) ? '微信号已复制' : '复制失败')));
    }
    card(wx.label, wxLines, wx.qr);
  }

  async share(): Promise<void> {
    const url = shareUrl();
    const b = this.sub('分享');
    b.append(el('p', '', '把像素东大分享给同学：'));
    const row = el('div', 'row');
    row.append(
      button('复制链接', 'primary small', async () => toast((await copyText(`像素东大 · 在像素校园里散步、相遇 ${url}`)) ? '链接已复制' : '复制失败')),
    );
    if (navigator.share && !isWeChat())
      row.append(button('系统分享', 'small', () => void navigator.share({ title: '像素东大 · Pixel NEU', text: '在像素风的南湖校区里散步、相遇', url }).catch(() => undefined)));
    b.append(row);
    b.append(el('h3', '', '分享海报'), el('p', 'fine', isWeChat() ? '长按图片保存或发送给朋友' : '右键或长按图片保存'));
    const img = el('img', 'poster');
    img.alt = '分享海报';
    b.append(img);
    try {
      img.src = await this.deps.poster();
    } catch {
      img.replaceWith(el('p', 'fine', '海报生成失败'));
    }
  }
}
