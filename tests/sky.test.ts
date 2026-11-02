import { describe, expect, it } from 'vitest';
import { ICONS } from '../shared/icons.ts';
import type { IconName } from '../shared/icons.ts';
import { SITE, moonPhase, moonPosition, moonTimes, sunPosition, sunTimes, weatherIcon, weatherText } from '../shared/sky.ts';

// TASK-13 的 PyEphem 4.2.1 基准，时间均为北京时间。
const solarDays = [
  { day: '2026-03-20', rise: '05:50', set: '17:58' },
  { day: '2026-06-21', rise: '04:12', set: '19:25' },
  { day: '2026-11-02', rise: '06:19', set: '16:40' },
  { day: '2026-12-21', rise: '07:10', set: '16:18' },
];
const solarPositions = [
  { time: '2026-06-21T05:00', az: 64.72, alt: 7.04 },
  { time: '2026-06-21T12:00', az: 188.64, alt: 71.50 },
  { time: '2026-06-21T18:00', az: 289.71, alt: 13.27 },
  { time: '2026-12-21T08:00', az: 129.98, alt: 6.74 },
  { time: '2026-12-21T12:00', az: 183.98, alt: 24.69 },
  { time: '2026-12-21T15:30', az: 230.30, alt: 6.52 },
  { time: '2026-11-02T09:00', az: 139.96, alt: 23.80 },
  { time: '2026-11-02T14:00', az: 220.04, alt: 23.72 },
];
const lunarPositions = [
  { time: '2026-11-02T21:00', az: 40.48, alt: -23.17, illum: 0.423, angle: 278.8, icon: 6 },
  { time: '2026-11-10T06:00', az: 109.13, alt: -15.31, illum: 0.004, angle: 7.1, icon: 0 },
  { time: '2026-11-17T18:00', az: 183.94, alt: 33.87, illum: 0.493, angle: 89.2, icon: 2 },
  { time: '2026-11-24T22:00', az: 125.77, alt: 65.36, illum: 1.000, angle: 179.5, icon: 4 },
  { time: '2026-12-01T03:00', az: 124.56, alt: 44.15, illum: 0.551, angle: 264.2, icon: 6 },
];
const lunarDays = [
  { day: '2026-11-02', rise: '23:40', set: '13:09' },
  { day: '2026-11-17', rise: '12:36', set: '23:05' },
];
const weather: { codes: number[]; text: string; day: IconName; night: IconName }[] = [
  { codes: [0, 1], text: '晴', day: 'sunny', night: 'clear-night' },
  { codes: [2], text: '多云', day: 'cloudy', night: 'cloudy-night' },
  { codes: [3], text: '阴', day: 'overcast', night: 'overcast' },
  { codes: [45, 48], text: '雾', day: 'fog', night: 'fog' },
  { codes: [51, 53, 55, 61, 80], text: '小雨', day: 'rain-light', night: 'rain-light' },
  { codes: [63, 81], text: '中雨', day: 'rain-heavy', night: 'rain-heavy' },
  { codes: [65, 82], text: '大雨', day: 'rain-heavy', night: 'rain-heavy' },
  { codes: [56, 57, 66, 67], text: '雨夹雪', day: 'sleet', night: 'sleet' },
  { codes: [71, 77, 85], text: '小雪', day: 'snow', night: 'snow' },
  { codes: [73], text: '中雪', day: 'snow', night: 'snow' },
  { codes: [75, 86], text: '大雪', day: 'snow', night: 'snow' },
  { codes: [95, 96, 99], text: '雷阵雨', day: 'thunder', night: 'thunder' },
];

const beijing = (time: string) => new Date(`${time}+08:00`);
const angleError = (actual: number, expected: number) => Math.abs(((actual - expected + 540) % 360) - 180);

describe('太阳', () => {
  it('使用南湖校区的经纬度', () => {
    expect(SITE).toEqual({ lat: 41.7655, lon: 123.4135 });
  });

  it.each(solarPositions)('$time 的方位角和几何高度角误差不超过 0.5°', ({ time, az, alt }) => {
    const actual = sunPosition(beijing(time));
    expect(angleError(actual.az, az)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(actual.alt - alt)).toBeLessThanOrEqual(0.5);
  });

  for (const event of ['rise', 'set'] as const) {
    it.each(solarDays)(`$day 的 ${event} 误差不超过 2 分钟`, (row) => {
      const actual = sunTimes(beijing(`${row.day}T00:30`))[event];
      expect(actual).toBeInstanceOf(Date);
      expect(Math.abs(actual!.getTime() - beijing(`${row.day}T${row[event]}`).getTime())).toBeLessThanOrEqual(2 * 60000);
    });
  }

  it('北京时间同一天的任意时刻得到相同日出日落，且不修改输入', () => {
    const day = beijing('2026-06-21T23:59:59'), before = day.getTime();
    expect(sunTimes(day)).toEqual(sunTimes(beijing('2026-06-21T00:00')));
    expect(day.getTime()).toBe(before);
  });

  it.each(solarDays)('$day 的日出日落对应太阳中心几何高度 −50′', ({ day }) => {
    const actual = sunTimes(beijing(`${day}T12:00`));
    for (const event of [actual.rise, actual.set]) {
      expect(Math.abs(sunPosition(event!).alt + 50 / 60)).toBeLessThan(0.005);
    }
    expect(sunPosition(new Date(actual.rise!.getTime() - 60000)).alt).toBeLessThan(-50 / 60);
    expect(sunPosition(new Date(actual.rise!.getTime() + 60000)).alt).toBeGreaterThan(-50 / 60);
    expect(sunPosition(new Date(actual.set!.getTime() - 60000)).alt).toBeGreaterThan(-50 / 60);
    expect(sunPosition(new Date(actual.set!.getTime() + 60000)).alt).toBeLessThan(-50 / 60);
  });
});

describe('月亮', () => {
  it.each(lunarPositions)('$time 的方位角和几何高度角误差不超过 1.5°', ({ time, az, alt }) => {
    const actual = moonPosition(beijing(time));
    expect(angleError(actual.az, az)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(actual.alt - alt)).toBeLessThanOrEqual(1.5);
  });

  it.each(lunarPositions)('$time 的照亮比例误差不超过 0.03', ({ time, illum }) => {
    expect(Math.abs(moonPhase(beijing(time)).illum - illum)).toBeLessThanOrEqual(0.03);
  });

  // 任务单未单列相位角容差，按月亮角度的 1.5° 验收。
  it.each(lunarPositions)('$time 的相位角误差不超过 1.5°', ({ time, angle }) => {
    expect(angleError(moonPhase(beijing(time)).angle, angle)).toBeLessThanOrEqual(1.5);
  });

  it.each(lunarPositions)('$time 的月相图标符合基准', ({ time, icon }) => {
    expect(moonPhase(beijing(time)).icon).toBe(icon);
  });

  it.each(lunarPositions)('$time 的照亮比例和图标遵守相位角公式', ({ time }) => {
    const actual = moonPhase(beijing(time));
    expect(actual.angle).toBeGreaterThanOrEqual(0);
    expect(actual.angle).toBeLessThan(360);
    expect(actual.illum).toBeCloseTo((1 - Math.cos(actual.angle * Math.PI / 180)) / 2, 12);
    expect(actual.icon).toBe(Math.round(actual.angle / 45) % 8);
  });

  for (const event of ['rise', 'set'] as const) {
    it.each(lunarDays)(`$day 的 ${event} 误差不超过 10 分钟`, (row) => {
      const actual = moonTimes(beijing(`${row.day}T00:30`))[event];
      expect(actual).toBeInstanceOf(Date);
      expect(Math.abs(actual!.getTime() - beijing(`${row.day}T${row[event]}`).getTime())).toBeLessThanOrEqual(10 * 60000);
    });
  }

  it('北京时间同一天得到相同月出月落，月落可以早于月出，且不修改输入', () => {
    const day = beijing('2026-11-02T23:59:59'), before = day.getTime();
    const actual = moonTimes(day);
    expect(actual).toEqual(moonTimes(beijing('2026-11-02T00:00')));
    expect(actual.set!.getTime()).toBeLessThan(actual.rise!.getTime());
    expect(day.getTime()).toBe(before);
  });

  it('当天没有月出时返回 null，不带入次日事件', () => {
    const day = beijing('2026-11-03T12:00');
    const actual = moonTimes(day);
    expect(actual.rise).toBeNull();
    expect(actual.set).toBeInstanceOf(Date);
    expect(actual.set!.getTime()).toBeGreaterThanOrEqual(beijing('2026-11-03T00:00').getTime());
    expect(actual.set!.getTime()).toBeLessThan(beijing('2026-11-04T00:00').getTime());
  });

  it('当天没有月落时返回 null，不带入次日事件', () => {
    const actual = moonTimes(beijing('2026-11-18T12:00'));
    expect(actual.rise).toBeInstanceOf(Date);
    expect(actual.set).toBeNull();
  });

  it.each(lunarDays)('$day 的月出月落对应月亮中心几何高度 0°', ({ day }) => {
    const actual = moonTimes(beijing(`${day}T12:00`));
    for (const event of [actual.rise, actual.set]) expect(Math.abs(moonPosition(event!).alt)).toBeLessThan(0.005);
    expect(moonPosition(new Date(actual.rise!.getTime() - 60000)).alt).toBeLessThan(0);
    expect(moonPosition(new Date(actual.rise!.getTime() + 60000)).alt).toBeGreaterThan(0);
    expect(moonPosition(new Date(actual.set!.getTime() - 60000)).alt).toBeGreaterThan(0);
    expect(moonPosition(new Date(actual.set!.getTime() + 60000)).alt).toBeLessThan(0);
  });
});

describe('天气', () => {
  for (const row of weather) {
    for (const night of [false, true]) {
      it.each(row.codes)(`WMO %i 的${night ? '夜间' : '白天'}图标和文字为${row.text}`, (code) => {
        const icon = weatherIcon(code, night);
        expect(icon).toBe(night ? row.night : row.day);
        expect(ICONS).toContain(icon);
        expect(weatherText(code)).toBe(row.text);
      });
    }
  }

  it.each([false, true])('未列出的码按阴天处理（夜间：%s）', (night) => {
    expect(weatherIcon(42, night)).toBe('overcast');
    expect(weatherText(42)).toBe('阴');
  });
});
