// 地图与共享规则的冒烟测试：重新生成地图（npm run map）后跑一遍，确认人还能从北门走到每个地点
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAME_MAX, cleanLook, cleanName } from '../shared/social.ts';
import { LAYER, TILE, Walkable, type TiledMap, type TiledObject } from '../shared/world.ts';

const map = JSON.parse(readFileSync(new URL('../assets/map.json', import.meta.url), 'utf8')) as TiledMap;
const walk = new Walkable(map);
const objectLayer = map.layers.find((l) => l.name === LAYER.objects);
const objects = (objectLayer?.type === 'objectgroup' ? objectLayer.objects : []) as TiledObject[];
const ofType = (type: string) => objects.filter((o) => o.type === type);

describe('地图', () => {
  it('有约定的图层和比例', () => {
    expect(map.tilewidth).toBe(TILE);
    for (const name of Object.values(LAYER)) expect(map.layers.some((l) => l.name === name)).toBe(true);
  });

  it('出生点可走', () => {
    const [spawn] = ofType('spawn');
    expect(spawn).toBeDefined();
    expect(walk.footBlocked(spawn.x, spawn.y)).toBe(false);
  });

  it('从出生点能走到每个地点', () => {
    const [spawn] = ofType('spawn');
    const pois = ofType('poi');
    expect(pois.length).toBeGreaterThanOrEqual(3);
    for (const p of pois) {
      const route = walk.path(spawn.x, spawn.y, p.x, p.y);
      expect(route.length, p.name).toBeGreaterThan(0);
      const end = route[route.length - 1];
      expect(Math.hypot(end.x - p.x, end.y - p.y), p.name).toBeLessThan(6 * TILE);
    }
    // 41 个地点各寻一次全图的路，机器忙时会超过默认的 5 秒
  }, 30_000);

  it('核心建筑都在，并带 OSM 来源', () => {
    const names = ofType('building').map((b) => b.name);
    for (const n of ['信息学馆', '宁恩承图书馆']) expect(names).toContain(n);
    for (const b of ofType('building')) expect(b.properties?.some((p) => p.name === 'osm')).toBe(true);
  });

  it('信息学馆和图书馆的楼基落在北门—鼎的中轴上', () => {
    // 卫星图斜拍，OSM 轮廓常偏在楼顶上（见 tools/survey.ts 的 buildings）；没校正时楼会偏西 4–7 m
    const axis = ofType('poi').find((p) => p.name === '北门')!.x;
    for (const name of ['信息学馆', '宁恩承图书馆']) {
      const b = ofType('building').find((o) => o.name === name)!;
      // 建筑对象的框就是楼基外接框，两栋楼都左右对称
      const centre = b.x + b.width / 2;
      expect(Math.abs(centre - axis), name).toBeLessThan(TILE);
    }
  });

  it('建筑脚下不可走', () => {
    // 信息学馆是朝南开口的 U 形，最北一排是主楼
    const info = ofType('building').find((b) => b.name === '信息学馆')!;
    expect(walk.footBlocked(info.x + info.width / 2, info.y + 2 * TILE)).toBe(true);
  });
});

describe('寻路', () => {
  it('终点在障碍里时停在最近的空地', () => {
    const info = ofType('building').find((b) => b.name === '信息学馆')!;
    const [spawn] = ofType('spawn');
    const route = walk.path(spawn.x, spawn.y, info.x + info.width / 2, info.y + 2);
    expect(route.length).toBeGreaterThan(0);
    const end = route[route.length - 1];
    expect(walk.footBlocked(end.x, end.y)).toBe(false);
  });

  it('路线上每一段都能直着走过去', () => {
    const [spawn] = ofType('spawn');
    const lib = ofType('poi').find((p) => p.name === '宁恩承图书馆')!;
    let cur = { x: spawn.x, y: spawn.y };
    for (const next of walk.path(spawn.x, spawn.y, lib.x, lib.y)) {
      const n = Math.ceil(Math.hypot(next.x - cur.x, next.y - cur.y) / 2);
      for (let k = 1; k <= n; k++) expect(walk.footBlocked(cur.x + ((next.x - cur.x) * k) / n, cur.y + ((next.y - cur.y) * k) / n)).toBe(false);
      cur = next;
    }
  });
});

describe('玩家输入清洗', () => {
  it('名字去掉控制字符并限长，空名给默认值', () => {
    expect(cleanName('  小明\u0000 ')).toBe('小明');
    expect([...cleanName('一二三四五六七八九十一二三四')].length).toBe(NAME_MAX);
    expect(cleanName('')).toBe('东大人');
  });

  it('外观序号越界时收回合法范围', () => {
    const look = cleanLook({ skin: 99, hair: -3, hairColor: 1.5, top: Number.NaN } as never);
    for (const v of Object.values(look)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
