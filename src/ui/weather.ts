// 顶栏的天空条（时刻、天气图标、气温，小弧线上太阳或月亮从东走到西）和点开后的天气面板。
import type { IconName } from '../../shared/icons.ts';
import { moonPhase, moonPosition, moonTimes, sunPosition, sunTimes, weatherIcon, weatherText } from '../../shared/sky.ts';
import { FALLBACK_WEATHER, type Weather } from '../../shared/weather.ts';
import { el, hhmm, icon, setIcon, Sheet } from './dom.ts';

const ARC_W = 48, ARC_H = 18;

let uiImg: HTMLImageElement | null = null;
const iconPos: Record<string, { x: number; y: number }> = {};

export class SkyChip {
  readonly el = el('button', 'chip sky-chip');
  private readonly arc = el('canvas', 'sky-arc');
  private readonly ic = icon('sunny');
  private readonly text = el('span');
  private weather: Weather = FALLBACK_WEATHER;
  private readonly sheet = new Sheet('天气');

  constructor() {
    this.arc.width = ARC_W;
    this.arc.height = ARC_H;
    this.el.append(this.arc, this.ic, this.text);
    this.el.title = '天气';
    this.el.addEventListener('click', () => (this.sheet.open ? this.sheet.close() : this.openSheet()));
    if (!uiImg) {
      uiImg = new Image();
      uiImg.src = 'ui.png';
      void fetch('ui.json')
        .then((r) => r.json())
        .then((j) => Object.assign(iconPos, j));
    }
    uiImg.addEventListener('load', () => this.tick());
    this.tick();
    setInterval(() => this.tick(), 30_000);
  }

  setWeather(w: Weather): void {
    this.weather = w;
    this.tick();
    if (this.sheet.open) this.openSheet();
  }

  /** 天亮着吗（太阳在地平线下 6° 以内算亮） */
  static night(t = new Date()): boolean {
    return sunPosition(t).alt < -6;
  }

  private shown(): number {
    return this.weather.stale ? 0 : this.weather.code;
  }

  private tick(): void {
    const now = new Date();
    const night = SkyChip.night(now);
    setIcon(this.ic, weatherIcon(this.shown(), night));
    this.text.textContent = `${hhmm(now)} ${weatherText(this.shown())}${this.weather.updated ? ` ${Math.round(this.weather.temp)}°` : ''}`;
    this.drawArc(now);
  }

  /** 弧线左端是东、右端是西；太阳在天上画太阳，否则画月亮（按真实高度角） */
  private drawArc(now: Date): void {
    const c = this.arc.getContext('2d')!;
    c.clearRect(0, 0, ARC_W, ARC_H);
    c.fillStyle = '#8a7f6c';
    for (let x = 2; x < ARC_W - 2; x++) {
      const u = (x - 2) / (ARC_W - 5);
      c.fillRect(x, Math.round(ARC_H - 3 - Math.sin(u * Math.PI) * (ARC_H - 8)), 1, 1);
    }
    c.fillRect(0, ARC_H - 2, ARC_W, 1);
    const sun = sunPosition(now);
    const body = sun.alt > -0.8 ? sun : moonPosition(now);
    const key: IconName = body === sun ? 'sun-disc' : 'moon-disc';
    if (body.alt < -0.8) return;
    // 方位角从东（90°）到西（270°）映射到弧线左右；北半天（夏天清晨傍晚）夹到两端
    const u = Math.min(1, Math.max(0, (body.az - 60) / 240));
    const x = 2 + u * (ARC_W - 5), y = ARC_H - 3 - Math.sin(u * Math.PI) * (ARC_H - 8);
    const p = iconPos[key];
    if (p && uiImg?.complete) c.drawImage(uiImg, p.x, p.y, 16, 16, Math.round(x - 6), Math.round(y - 6), 12, 12);
  }

  private openSheet(): void {
    const w = this.weather, now = new Date();
    const b = this.sheet.body;
    b.replaceChildren();
    const night = SkyChip.night(now);
    const head = el('div', 'wx-now');
    const t = el('div');
    t.append(el('div', 'temp', w.updated ? `${Math.round(w.temp)}°C` : '--'), el('div', '', `${weatherText(this.shown())} · 沈阳南湖`));
    head.append(icon(weatherIcon(this.shown(), night), 2), t);
    b.append(head);
    if (w.stale) b.append(el('p', 'fine', w.updated ? `天气超过 1 小时没更新（上次 ${hhmm(w.updated)}），暂按「晴」显示。` : '暂时取不到天气，按「晴」显示。'));

    const st = sunTimes(now), mt = moonTimes(now), ph = moonPhase(now);
    const grid = el('div', 'wx-grid');
    const cell = (k: string, v: string, ic?: IconName) => {
      const d = el('div');
      if (ic) d.append(icon(ic), document.createTextNode(' '));
      d.append(el('span', 'fine', `${k} `), document.createTextNode(v));
      grid.append(d);
    };
    const tm = (d: Date | null) => (d ? hhmm(d) : '无');
    cell('日出', tm(st.rise), 'sun-disc');
    cell('日落', tm(st.set));
    cell('月出', tm(mt.rise), 'moon-disc');
    cell('月落', tm(mt.set));
    cell('月相', `${Math.round(ph.illum * 100)}%`, `moon-${ph.icon}` as IconName);
    if (w.updated) {
      cell('湿度', `${Math.round(w.humidity)}%`);
      cell('风速', `${Math.round(w.wind)} km/h`);
      if (w.snow > 0) cell('积雪', `${w.snow} cm`, 'snow');
    }
    b.append(grid);

    if (w.hourly.length) {
      b.append(el('h3', '', '未来 24 小时'));
      const hours = el('div', 'wx-hours');
      for (const h of w.hourly) {
        const d = el('div', 'wx-hour');
        d.append(el('span', 'fine', hhmm(h.t).slice(0, 2) + '时'), icon(weatherIcon(h.code, sunPosition(new Date(h.t)).alt < -6)), el('span', '', `${h.temp}°`));
        if (h.pop >= 30) d.append(el('span', 'fine', `${h.pop}%`));
        hours.append(d);
      }
      b.append(hours);
    }
    b.append(el('p', 'fine', '天气数据 Open-Meteo（CC-BY 4.0），每 10 分钟更新。日月按南湖校区经纬度实时计算。'));
    this.sheet.show();
  }
}
