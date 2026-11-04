# TASK-43：西南片地面和楼形（x -500–-120、y 500–820）

## 目标

楼间现在是大片草坪，卫星图上多是铺装、球场和停车；西北角那栋楼现在是一个大 U 形（约 x -495–-390、y 515–700），卫星图上像是两栋南北向的板楼夹一片场地，要核实。

## 范围

世界米坐标 x -500–-120、y 500–820。范围外不动（另外两张单同时在做相邻的块）。楼门不在这张单里，不写 `doors`。

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

1. `npm run compare -- --ground -500 500 -120 820 2` 看全貌。
- 先核那栋 U 形楼：check 图上看红线和卫星图墙脚；确实是两栋板楼的，`drop` 后在 `newBuildings` 分开重描，中间的场地（有蓝色球场）按卫星图描。
- 楼间地面按卫星图改：铺装 `paving`、停车 `parking`、球场 `court`；有成片树冠的才留 `wood`/`grass`。
- 田径场西侧一排篮球场（约 x -365–-345）TASK-30 已画 `court`，不动。
- 新面后写的盖住先写的：追加在 `areas` 末尾即可；和已有面接边时用已有面那条边上的坐标。
2. 每改完一块（80 × 80 m）跑 `npm run map`，用 `--ground` 对比复查这一块。不要每块都跑 `npm run art`。
3. 全部做完跑一次验收。

## 验收

- [ ] `npm run map && npm run art && npm run typecheck && npm test` 全部通过
- [ ] `npm run compare -- --ground -500 500 -120 820 2`：地面的铺装、草地、林地、停车、球场和卫星图一块块对得上
- [ ] 回复里列出：新增和改了多少个面，改了哪几栋楼（编号）、记了哪些「待核实」
