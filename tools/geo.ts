// 经纬度 ↔ 世界坐标（米，上北）。地图、卫星图、对照图都用这一套。
// 1. 以 LAT0/LON0 为原点做局部平面近似：x 向东，y 向南
// 2. 校园路网整体偏转约 3.85°，转正后主要楼和路对齐网格
// 3. 平移到 ORIGIN：世界坐标 (0, 0) 固定在最初那张地图的西北角（北门外约 30 m），以后扩图也不变，
//    所以 survey.json 和文档里的坐标永远有效；扩出去的地方坐标可以是负数。
//    世界米坐标换成格：先减去 EXTENT 的西北角，再除以 METERS_PER_TILE
import { METERS_PER_TILE } from '../shared/world.ts';

export type P = [number, number];

const LAT0 = 41.7655, LON0 = 123.4135;
const M_LAT = 111320, M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
/** 偏转角：信息学馆北墙（OSM way 87664797）量得 3.84°，图书馆北墙 3.92° */
const ROT = (3.85 * Math.PI) / 180;
const cos = Math.cos(ROT), sin = Math.sin(ROT);

/** 世界原点在转正后的局部米坐标里的位置 */
const ORIGIN = { x: -136, y: -282 };

/** 地图范围（世界米坐标）：南湖校区校界（OSM way 53573481）外扩约 80 m，带上四周的马路和对面一排楼 */
export const EXTENT = { x0: -588, y0: -60, x1: 708, y1: 1092 };
export const MAP_W = (EXTENT.x1 - EXTENT.x0) / METERS_PER_TILE;
export const MAP_H = (EXTENT.y1 - EXTENT.y0) / METERS_PER_TILE;

/** 经纬度 → 世界米坐标 */
export function toWorld(lat: number, lon: number): P {
  const x = (lon - LON0) * M_LON, y = (LAT0 - lat) * M_LAT;
  return [x * cos + y * sin - ORIGIN.x, -x * sin + y * cos - ORIGIN.y];
}

/** 世界米坐标 → 经纬度 */
export function toLatLon([wx, wy]: P): P {
  const xr = wx + ORIGIN.x, yr = wy + ORIGIN.y;
  const x = xr * cos - yr * sin, y = xr * sin + yr * cos;
  return [LAT0 - y / M_LAT, LON0 + x / M_LON];
}

/** 卫星底图的来源，第一个是默认（tools/sat.ts 抓取，存为 data/sat-<来源>.png） */
export const SAT_SOURCES = ['2025-07-31', '2026-10-29', '2024-03-28', 'tianditu'] as const;

/** 卫星底图的分辨率：每米 4 像素（影像原始分辨率约 0.34 m） */
export const SAT_PPM = 4;

/** 世界米坐标 → 未转正的局部米坐标（x 向东，y 向南，原点 LAT0/LON0） */
export function toLocal([wx, wy]: P): P {
  const xr = wx + ORIGIN.x, yr = wy + ORIGIN.y;
  return [xr * cos - yr * sin, xr * sin + yr * cos];
}
