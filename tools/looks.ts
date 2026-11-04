// 楼型样张：不跑整套 npm run art，快速看楼型、特色构件和单栋楼。输出 data/looks-sheet.png（放大 2 倍，不进仓库）。
//   node tools/looks.ts            每个楼型一栋 24 × 14 m 的样楼（南、北两面），再加一栋构件和门头的示范楼、两栋坡屋顶
//   node tools/looks.ts 87664797 -3  这几栋楼（OSM 编号；survey 补描的楼写负数）四个视角，从左到右 N E S W
import { VIEWS } from '../shared/view.ts';
import { drawBuilding } from './art-building.ts';
import { levelPx, loadBuildings, type BuildingModel } from './buildings.ts';
import { LOOKS } from './facades.ts';
import { EXTENT, toWorld } from './geo.ts';
import { Pix } from './pix.ts';
import { PPM } from './shape.ts';
import { loadSurvey, type Feature, type Survey } from './survey.ts';
import { readFileSync } from 'node:fs';

const ids = process.argv.slice(2).map(Number);
const rows: Pix[][] = [];

/** 一栋放在世界原点附近的矩形样楼：w × d 米，storeys 层 */
function sample(look: string, w: number, d: number, storeys: number, extra: Partial<BuildingModel> = {}): BuildingModel {
  const W = w * PPM, H = d * PPM;
  return {
    id: 1, name: '', style: 'plain', x: 0, y: 0, w: W, h: H, part: new Uint8Array(W * H).fill(1),
    parts: [{ wall: levelPx(storeys), roof: 'flat', rise: 0 }], extraTop: 0, look, tweak: {}, features: [], doors: [], ...extra,
  };
}
/** 样楼上的世界米坐标：南墙 y = d，北墙 y = 0（相对样楼西北角） */
const at = (x: number, y: number): [number, number] => [EXTENT.x0 + x, EXTENT.y0 + y];

if (ids.length) {
  const osm = JSON.parse(readFileSync(new URL('../data/osm.json', import.meta.url), 'utf8'));
  const gate = osm.elements.find((e: { tags: Record<string, string> }) => e.tags.name === '北门');
  const all = loadBuildings(osm, loadSurvey(), toWorld(gate.lat, gate.lon)[0]);
  for (const id of ids) {
    const b = all.find((m) => m.id === id);
    if (!b) throw new Error(`没有楼 ${id}（可能被 drop 了，或者不在 EXTENT 里）`);
    rows.push(VIEWS.map((v) => drawBuilding(b, v)));
    console.log(`${id}：${b.name || '（无名）'}，楼型 ${b.look}，${b.features.length} 个构件，${b.doors.length} 个门`);
  }
} else {
  const names = Object.keys(LOOKS);
  for (const name of names) rows.push([drawBuilding(sample(name, 24, 14, name === 'dorm' ? 6 : 4), 0), drawBuilding(sample(name, 24, 14, name === 'dorm' ? 6 : 4), 2)]);
  console.log(`楼型（从上到下，左南面、右北面）：${names.join('、')}`);
  // 示范楼：南墙上从西到东依次是外挂楼梯、镂空、花格、玻璃带、柱廊、正门门廊、饰面、侧门
  const S = 20;
  const features: Feature[] = [
    { kind: 'stair', face: 'S', from: at(1, S), to: at(6, S), storeys: [0, 3] },
    { kind: 'void', face: 'S', from: at(8, S), to: at(14, S), storeys: [0, 1] },
    { kind: 'screen', face: 'S', from: at(16, S), to: at(22, S), storeys: [1, 3] },
    { kind: 'glass', face: 'S', from: at(24, S), to: at(27, S) },
    { kind: 'colonnade', face: 'S', from: at(29, S), to: at(41, S), storeys: [0, 0] },
    { kind: 'band', face: 'S', from: at(50, S), to: at(58, S), storeys: [2, 3], color: 'redbrick' },
  ];
  const doors: Survey['doors'] = [
    { at: at(46, S), facing: 'S', main: true, canopy: 'portico' },
    { at: at(54, S), facing: 'S' },
    { at: at(61, S), facing: 'S', main: true },
  ];
  rows.push([drawBuilding(sample('tile', 64, S, 4, { features, doors }), 0)]);
  console.log('示范楼（tile）：外挂楼梯、镂空两层、花格、玻璃带、首层柱廊、门廊正门、红砖饰面、侧门、雨棚正门');
  const gable = sample('brick', 24, 12, 3);
  gable.parts[0] = { ...gable.parts[0], roof: 'gable', rise: 3 * PPM };
  const hip = sample('ochre', 24, 14, 3, { tweak: { roof: ['tileRed0', 'tileRed1', 'tileRed1'] } });
  hip.parts[0] = { ...hip.parts[0], roof: 'hip', rise: 4 * PPM };
  rows.push([drawBuilding(gable, 0), drawBuilding(hip, 0), drawBuilding(hip, 1)]);
  console.log('坡屋顶：双坡红砖（南）、四坡黄楼红瓦（南、东）');
}

const gap = 8, k = 2;
const W = Math.max(...rows.map((r) => r.reduce((a, p) => a + p.w + gap, gap)));
const H = rows.reduce((a, r) => a + Math.max(...r.map((p) => p.h)) + gap, gap);
const sheet = new Pix(W, H);
sheet.rect(0, 0, W, H, 'grass1');
let y = gap;
for (const r of rows) {
  let x = gap;
  for (const p of r) {
    sheet.blit(p, x, y);
    x += p.w + gap;
  }
  y += Math.max(...r.map((p) => p.h)) + gap;
}
const big = new Pix(W * k, H * k);
for (let yy = 0; yy < H; yy++)
  for (let xx = 0; xx < W; xx++) {
    const i = (yy * W + xx) * 4;
    big.rect(xx * k, yy * k, k, k, (sheet.data[i] << 16) | (sheet.data[i + 1] << 8) | sheet.data[i + 2]);
  }
big.save(new URL('../data/looks-sheet.png', import.meta.url));
console.log('已输出 data/looks-sheet.png');
