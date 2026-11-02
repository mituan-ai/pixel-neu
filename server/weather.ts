// 实况天气：每 10 分钟从 Open-Meteo 取一次沈阳南湖的天气，变化时通知订阅者（各房间再广播）。
// WEATHER=off 关掉（离线开发）；取不到时保留上一次的结果，超过 1 小时标记 stale。
import { SITE } from '../shared/sky.ts';
import { FALLBACK_WEATHER, type Weather } from '../shared/weather.ts';

const EVERY = 10 * 60_000;
const STALE = 60 * 60_000;
const URL_ =
  'https://api.open-meteo.com/v1/forecast' +
  `?latitude=${SITE.lat}&longitude=${SITE.lon}` +
  '&current=temperature_2m,weather_code,snow_depth,precipitation,wind_speed_10m,relative_humidity_2m' +
  '&hourly=temperature_2m,weather_code,precipitation_probability&forecast_hours=24&timezone=Asia%2FShanghai&timeformat=unixtime';

interface OpenMeteo {
  current: { temperature_2m: number; weather_code: number; snow_depth: number; precipitation: number; wind_speed_10m: number; relative_humidity_2m: number };
  hourly: { time: number[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability: number[] };
}

/** 把 Open-Meteo 的返回整理成 Weather */
export function parseOpenMeteo(j: OpenMeteo, now = Date.now()): Weather {
  const c = j.current, h = j.hourly;
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    code: num(c.weather_code),
    temp: Math.round(num(c.temperature_2m) * 10) / 10,
    snow: Math.round(num(c.snow_depth) * 1000) / 10,
    precip: num(c.precipitation),
    wind: num(c.wind_speed_10m),
    humidity: num(c.relative_humidity_2m),
    hourly: (h?.time ?? []).slice(0, 24).map((t, i) => ({
      t: t * 1000,
      code: num(h.weather_code[i]),
      temp: Math.round(num(h.temperature_2m[i])),
      pop: num(h.precipitation_probability[i]),
    })),
    updated: now,
    stale: false,
  };
}

let current: Weather = FALLBACK_WEATHER;
const subs = new Set<(w: Weather) => void>();
let started = false;

async function refresh(): Promise<void> {
  try {
    const r = await fetch(URL_, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    current = parseOpenMeteo((await r.json()) as OpenMeteo);
  } catch (e) {
    console.warn('天气获取失败：', (e as Error).message);
    if (!current.stale && Date.now() - current.updated > STALE) current = { ...current, stale: true };
  }
  for (const f of subs) f(current);
}

export const weather = {
  get(): Weather {
    return current;
  },
  /** 订阅更新，返回取消订阅的函数；第一次订阅时开始轮询 */
  subscribe(f: (w: Weather) => void): () => void {
    subs.add(f);
    if (!started && process.env.WEATHER !== 'off') {
      started = true;
      void refresh();
      setInterval(refresh, EVERY).unref();
    }
    return () => subs.delete(f);
  },
};
