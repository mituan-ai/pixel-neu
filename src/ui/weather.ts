// 顶栏的天空条（天气图标、时刻、气温）和点开后的天气面板（现在、日出日落、未来 24 小时）。
import { sunPosition, sunTimes, weatherIcon, weatherText } from '../../shared/sky.ts';
import { FALLBACK_WEATHER, type Weather } from '../../shared/weather.ts';
import { el, hhmm, icon, setIcon, Sheet } from './dom.ts';

export class SkyChip {
  readonly el = el('button', 'chip sky-chip');
  private readonly ic = icon('sunny');
  private readonly text = el('span');
  private weather: Weather = FALLBACK_WEATHER;
  private readonly sheet = new Sheet('天气');

  constructor() {
    this.el.append(this.ic, this.text);
    this.el.title = '天气';
    this.el.addEventListener('click', () => (this.sheet.open ? this.sheet.close() : this.openSheet()));
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
    setIcon(this.ic, weatherIcon(this.shown(), SkyChip.night(now)));
    this.text.textContent = `${hhmm(now)}${this.weather.updated ? ` ${Math.round(this.weather.temp)}°` : ''}`;
    this.el.setAttribute('aria-label', `${hhmm(now)} ${weatherText(this.shown())}，打开天气`);
  }

  private openSheet(): void {
    const w = this.weather, now = new Date();
    const b = this.sheet.body;
    b.replaceChildren();
    const head = el('div', 'wx-now');
    const t = el('div');
    const st = sunTimes(now);
    const tm = (d: Date | null) => (d ? hhmm(d) : '—');
    t.append(
      el('div', 'temp', w.updated ? `${Math.round(w.temp)}°C` : '--'),
      el('div', '', weatherText(this.shown())),
      el('div', 'fine', `日出 ${tm(st.rise)} · 日落 ${tm(st.set)}`),
    );
    head.append(icon(weatherIcon(this.shown(), SkyChip.night(now)), 2), t);
    b.append(head);
    if (w.stale) b.append(el('p', 'fine', '暂时取不到天气，按「晴」显示。'));

    if (w.hourly.length) {
      const hours = el('div', 'wx-hours');
      for (const h of w.hourly) {
        const d = el('div', 'wx-hour');
        d.append(el('span', 'fine', hhmm(h.t).slice(0, 2) + '时'), icon(weatherIcon(h.code, sunPosition(new Date(h.t)).alt < -6)), el('span', '', `${h.temp}°`));
        if (h.pop >= 30) d.append(el('span', 'fine', `${h.pop}%`));
        hours.append(d);
      }
      b.append(hours);
    }
    this.sheet.show();
  }
}
