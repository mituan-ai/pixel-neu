# TASK-41：东片校内未描区（x 360–500、y 400–1000）

## 目标

这一条在校界里，但从来没描过地面：`--ground` 对比图上是校外的米色底，楼是灰盒子。要按校内的精度把地面整片描起来。

## 范围

世界米坐标 x 360–500、y 400–1000。范围外不动（另外两张单同时在做相邻的块）。楼门不在这张单里，不写 `doors`。

## 依据

- 地面对比：`npm run compare -- --ground x0 y0 x1 y1 4`（左边只有地面，跑过 `npm run map` 就有，不用跑 `npm run art`）
- 描图：`npm run check -- 2025-07-31 x0 y0 x1 y1 8`，按 80 × 80 m 一块切；树荫下看不清的对照 `2026-10-29`
- `docs/refs/` 里这一片的档案和 `docs/refs/video.md` 的截图

## 相关文件（只读）

- `AGENTS.md`、`docs/mapping.md`（粗细原则、规整化、地面描法）
- `tools/survey.ts`

## 可以改的文件

- `data/survey.json`：范围内的 `areas`、`stalls`、`bikeRacks`、`treeRows`、`trees`、`newBuildings`；范围内 OSM 楼 `buildings` 条目的 `shift`、`drop`、`storeys`
- `docs/sources.md`：「待核实」
- `docs/refs/` 里这一片的档案

## 步骤

1. `npm run compare -- --ground 360 400 500 1000 2` 看全貌。
- 先确认校界：check 图上 OSM 校界（`tools/map.ts` 里的 way 53573481）在这一带的走向；校界以西是校内，按校内精度描。
- 车行道、楼间路、停车场、铺装、草地、林地、球场，按 `docs/mapping.md`「地面：每个街区描什么」的顺序整片铺满，不留米色。
- 楼：check 图上红线和墙脚差 > 2 m 的修 `shift`，没有 OSM 轮廓的补 `newBuildings`（层数看不出写 6，记「待核实」）。
- 新面后写的盖住先写的：追加在 `areas` 末尾即可；和已有面接边时用已有面那条边上的坐标。
2. 每改完一块（80 × 80 m）跑 `npm run map`，用 `--ground` 对比复查这一块。不要每块都跑 `npm run art`。
3. 全部做完跑一次验收。

## 验收

- [ ] `npm run map && npm run art && npm run typecheck && npm test` 全部通过
- [ ] `npm run compare -- --ground 360 400 500 1000 2`：地面的铺装、草地、林地、停车、球场和卫星图一块块对得上
- [ ] 回复里列出：新增和改了多少个面，改了哪几栋楼（编号）、记了哪些「待核实」
