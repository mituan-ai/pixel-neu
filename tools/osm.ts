// 从 OpenStreetMap（Overpass API）抓取校园一片区域的原始数据，存到 data/osm.json。
// 数据以 ODbL 授权，使用时须署名 “© OpenStreetMap contributors”（见 docs/sources.md）。
// 用法：npm run osm            扩展到新区域时先改 BBOX，再重新生成地图（npm run map）
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

/** 南湖校区北部：北门 — 信息学馆 — 宁恩承图书馆 — 汉卿北路（南, 西, 北, 东） */
const BBOX = [41.762, 123.408, 41.769, 123.419];
const ENDPOINT = 'https://overpass-api.de/api/interpreter';

const query = `[out:json][timeout:90];(nwr(${BBOX.join(',')}););out geom;`;
// 用 curl 而不是 fetch：curl 会走系统代理（http(s)_proxy），Node 22 的 fetch 不会
const body = execFileSync('curl', [
  '-sSf', '-m', '120', '-A', 'pixel-neu/0.1 (map research)', ENDPOINT, '--data-urlencode', `data=${query}`,
], { maxBuffer: 64 << 20 });
const raw = JSON.parse(body.toString());

// 只留有标签的要素：无标签的节点只是线的顶点，几何已经内联在 way 里
const elements = raw.elements.filter((e: { tags?: object }) => e.tags);
const out = {
  source: 'OpenStreetMap via Overpass API',
  license: 'ODbL 1.0 — © OpenStreetMap contributors',
  fetched: new Date().toISOString().slice(0, 10),
  osmBase: raw.osm3s?.timestamp_osm_base,
  bbox: BBOX,
  elements,
};
writeFileSync(new URL('../data/osm.json', import.meta.url), JSON.stringify(out));
console.log(`data/osm.json：${elements.length} 个要素`);
