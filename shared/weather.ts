// 天气数据格式：服务端从 Open-Meteo 取来整理成这样，广播给所有房间。
// 数据 © Open-Meteo（CC-BY 4.0），界面上要署名「天气数据 Open-Meteo」。

export interface Weather {
  /** WMO 天气码，图标和文字见 shared/sky.ts 的 weatherIcon、weatherText */
  code: number;
  /** 气温 °C */
  temp: number;
  /** 积雪深度（cm） */
  snow: number;
  /** 当前降水（mm） */
  precip: number;
  /** 风速 km/h */
  wind: number;
  /** 相对湿度 % */
  humidity: number;
  /** 未来 24 小时，t 为毫秒时间戳，pop 为降水概率 % */
  hourly: { t: number; code: number; temp: number; pop: number }[];
  /** 这份数据取到的时间（毫秒） */
  updated: number;
  /** 超过 1 小时没取到新数据：界面按「晴」显示并注明 */
  stale: boolean;
}

/** 取不到天气时的默认值 */
export const FALLBACK_WEATHER: Weather = { code: 0, temp: 15, snow: 0, precip: 0, wind: 0, humidity: 50, hourly: [], updated: 0, stale: true };

/** 降雨、降雪的强度 0–3（0 没有），给粒子用 */
export function precipLevel(code: number): { rain: number; snow: number } {
  const rain: Record<number, number> = { 51: 1, 53: 1, 55: 1, 61: 1, 80: 1, 63: 2, 81: 2, 65: 3, 82: 3, 95: 2, 96: 3, 99: 3, 56: 1, 57: 1, 66: 1, 67: 2 };
  const snow: Record<number, number> = { 71: 1, 77: 1, 85: 1, 73: 2, 75: 3, 86: 3, 56: 1, 57: 1, 66: 1, 67: 1 };
  return { rain: rain[code] ?? 0, snow: snow[code] ?? 0 };
}
