// 日月与天气：南湖校区的太阳、月亮位置，日出日落、月出月落，月相，WMO 天气码归类。纯函数，浏览器和服务端共用；基准值见 tests/sky.test.ts。
import type { IconName } from './icons.ts';

export const SITE = { lat: 41.7655, lon: 123.4135 } as const;

/** 方位角从正北顺时针（度），高度角（度，几何高度，不加折射） */
export interface Body { az: number; alt: number }

const RAD = Math.PI / 180, DAY = 86400000, BEIJING = 8 * 3600000;
type Ecliptic = { lon: number; lat: number; distance: number };

// Meeus《天文算法》表 47.A 前 16 项：D、M、M′、F、黄经（微度）、距离（米）。
const LUNAR_LONGITUDE = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
];
// 表 47.B 前 16 项：D、M、M′、F、黄纬（微度）。
const LUNAR_LATITUDE = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
];

function normalize(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function epochDays(t: Date): number {
  return t.getTime() / DAY - 10957.5;
}

/** Meeus 第 25 章的低精度太阳黄道坐标，距离单位为千米。 */
function solar(t: Date): Ecliptic {
  const T = epochDays(t) / 36525;
  const mean = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const anomaly = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * RAD;
  const center = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(anomaly)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * anomaly) + 0.000289 * Math.sin(3 * anomaly);
  const eccentricity = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  return {
    lon: normalize(mean + center - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * T) * RAD)),
    lat: 0,
    distance: 149597870.7 * 1.000001018 * (1 - eccentricity * eccentricity)
      / (1 + eccentricity * Math.cos(anomaly + center * RAD)),
  };
}

/** Meeus 第 47 章的月球主要周期项，距离单位为千米。 */
function lunar(t: Date): Ecliptic {
  const T = epochDays(t) / 36525, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const mean = normalize(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
  const D = normalize(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000) * RAD;
  const M = normalize(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000) * RAD;
  const Mp = normalize(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000) * RAD;
  const F = normalize(93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000) * RAD;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const A1 = (119.75 + 131.849 * T) * RAD, A2 = (53.09 + 479264.290 * T) * RAD, A3 = (313.45 + 481266.484 * T) * RAD;
  let longitude = 3958 * Math.sin(A1) + 1962 * Math.sin(mean * RAD - F) + 318 * Math.sin(A2);
  let latitude = -2235 * Math.sin(mean * RAD) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F)
    + 175 * Math.sin(A1 + F) + 127 * Math.sin(mean * RAD - Mp) - 115 * Math.sin(mean * RAD + Mp);
  let distance = 0;
  for (const [d, m, mp, f, lon, r] of LUNAR_LONGITUDE) {
    const angle = d * D + m * M + mp * Mp + f * F, factor = E ** Math.abs(m);
    longitude += lon * factor * Math.sin(angle);
    distance += r * factor * Math.cos(angle);
  }
  for (const [d, m, mp, f, lat] of LUNAR_LATITUDE) {
    latitude += lat * E ** Math.abs(m) * Math.sin(d * D + m * M + mp * Mp + f * F);
  }
  return { lon: normalize(mean + longitude / 1000000), lat: latitude / 1000000, distance: 385000.56 + distance / 1000 };
}

/** 南湖校区站心地平坐标，包含地球扁率与视差。 */
function horizontal(t: Date, body: Ecliptic): Body {
  const days = epochDays(t), T = days / 36525;
  const obliquity = (23.439291111 - 0.013004167 * T - 0.000000164 * T * T + 0.000000504 * T * T * T) * RAD;
  const lon = body.lon * RAD, lat = body.lat * RAD, phi = SITE.lat * RAD;
  const sidereal = normalize(280.46061837 + 360.98564736629 * days + 0.000387933 * T * T - T * T * T / 38710000 + SITE.lon) * RAD;
  const x = body.distance * Math.cos(lat) * Math.cos(lon);
  const y = body.distance * (Math.cos(lat) * Math.sin(lon) * Math.cos(obliquity) - Math.sin(lat) * Math.sin(obliquity));
  const z = body.distance * (Math.cos(lat) * Math.sin(lon) * Math.sin(obliquity) + Math.sin(lat) * Math.cos(obliquity));
  const u = Math.atan(0.99664719 * Math.tan(phi));
  const meridian = x * Math.cos(sidereal) + y * Math.sin(sidereal) - 6378.14 * Math.cos(u);
  const polar = z - 6378.14 * 0.99664719 * Math.sin(u);
  const east = -x * Math.sin(sidereal) + y * Math.cos(sidereal);
  const north = polar * Math.cos(phi) - meridian * Math.sin(phi);
  const up = meridian * Math.cos(phi) + polar * Math.sin(phi);
  return { az: normalize(Math.atan2(east, north) / RAD), alt: Math.atan2(up, Math.hypot(east, north)) / RAD };
}

export function sunPosition(t: Date): Body {
  return horizontal(t, solar(t));
}

export function moonPosition(t: Date): Body {
  return horizontal(t, lunar(t));
}

/** angle：相位角 0–360（0 新月、180 满月）；illum：照亮比例 0–1；icon：0–7，对应 moon-0…moon-7。 */
export function moonPhase(t: Date): { angle: number; illum: number; icon: number } {
  const angle = normalize(lunar(t).lon - solar(t).lon);
  return { angle, illum: (1 - Math.cos(angle * RAD)) / 2, icon: Math.round(angle / 45) % 8 };
}

/** 北京时间自然日内，按十分钟采样并二分求过线事件。 */
function crossings(day: Date, position: (t: Date) => Body, horizon: number): { rise: Date | null; set: Date | null } {
  const start = Math.floor((day.getTime() + BEIJING) / DAY) * DAY - BEIJING, end = start + DAY;
  let rise: Date | null = null, set: Date | null = null;
  let left = start, before = position(new Date(left)).alt - horizon;
  for (let right = start + 10 * 60000; right <= end; right += 10 * 60000) {
    const after = position(new Date(right)).alt - horizon;
    const rising = before <= 0 && after > 0, setting = before >= 0 && after < 0;
    if (rising || setting) {
      let lo = left, hi = right;
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2, altitude = position(new Date(mid)).alt - horizon;
        if ((altitude > 0) === rising) hi = mid;
        else lo = mid;
      }
      const event = new Date((lo + hi) / 2);
      if (event.getTime() < end) {
        if (rising) rise = event;
        else set = event;
      }
    }
    left = right;
    before = after;
  }
  return { rise, set };
}

/** day 是这一天里的任意时刻，按北京时间取自然日。 */
export function sunTimes(day: Date): { rise: Date | null; set: Date | null } {
  return crossings(day, sunPosition, -50 / 60);
}

export function moonTimes(day: Date): { rise: Date | null; set: Date | null } {
  return crossings(day, moonPosition, 0);
}

const WEATHER: { codes: number[]; text: string; day: IconName; night: IconName }[] = [
  { codes: [0, 1], text: '晴', day: 'sunny', night: 'clear-night' },
  { codes: [2], text: '多云', day: 'cloudy', night: 'cloudy-night' },
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

export function weatherIcon(code: number, night: boolean): IconName {
  const row = WEATHER.find((entry) => entry.codes.includes(code));
  return row ? (night ? row.night : row.day) : 'overcast';
}

export function weatherText(code: number): string {
  return WEATHER.find((entry) => entry.codes.includes(code))?.text ?? '阴';
}
