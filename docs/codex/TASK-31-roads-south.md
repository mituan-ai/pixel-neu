# TASK-31：南片道路、地面和楼门重描（y 615–820）

## 目标

这一片的车行道、院内支路、楼间通道、人行道、停车场和卫星图对得上；路口有斑马线和停止线；卫星图上看得见的单车棚描进来；每栋校内楼至少有一个正门。做完后人在这一片走，路通不通、从哪进楼，和现实一样。

## 范围

- 地面、路、标线、单车棚：世界米坐标 y 615–820，x -588–708（校外只修车行道和挡路的大错，按 `docs/mapping.md` 校外的精度）。
- 楼和楼门：`node tools/looks.ts --list 615 820` 列出的校内楼。
- 范围外的东西一律不动：另外几张单同时在做相邻的片。

## 依据

- 卫星图对照图：`npm run check -- 2025-07-31 x0 y0 x1 y1 8`，按 100 × 100 m 一块切；树荫下看不清的用 `2026-10-29` 那期对照
- 现状对比：`npm run compare -- x0 y0 x1 y1 4`（左边是现在画出来的，右边是卫星图）。左边的楼顶按高度往北抬，楼看起来比卫星图偏北：路和地面看 compare，楼的位置看 check 的红线
- 视频截图：`docs/refs/video.md`（路口、楼门、门牌）；`docs/refs/` 里这一片的档案
- OSM 路网（check 图上看不到时，查 `data/osm.json` 里 `highway` 的 way）只作参考，和卫星图冲突以卫星图为准

## 已知问题（维护者对比时看到的，先处理）

- 约 x -280–-170、y 615–680 现在是一块米色铺装，卫星图上是带内院的大楼：查 OSM 红线，有就修 `shift`，没有就在 `newBuildings` 补描墙脚，内院按卫星图写地面。
- 田径场南侧和西侧的楼间路、停车。

## 相关文件（只读）

- `AGENTS.md`、`docs/mapping.md`（粗细原则、规整化、地面描法、楼的外观里的「门」）
- `tools/survey.ts`：`areas`（`line`、`width`、`curve`、`corner`、`dash`）、`marks`、`bikeRacks`、`stalls`、`doors`、`newBuildings`、`buildings.drop`
- `tools/ground.ts`：路口倒圆和路缘怎么画（只读，理解 `corner`）

## 可以改的文件

- `data/survey.json`：范围内的 `areas`、`marks`、`bikeRacks`、`stalls`、`treeRows`、`trees`、`newBuildings`；范围内 OSM 楼的 `buildings` 条目只加 `shift`、`drop`、`storeys`；落在范围内楼上的 `doors`
- `docs/sources.md`：「待核实」
- `docs/refs/` 里这一片的档案：补本轮用到的资料和楼门记录

## 步骤

1. 跑 `npm run compare -- -588 615 708 820 2` 看全貌，把这一片切成 100 × 100 m 的块，从「已知问题」那几块开始，逐块处理。每块改完 `npm run map && npm run art`，用 compare 复查这一块。
2. **车行道**：走向、位置、宽度对卫星图，按 `docs/mapping.md` 规整化（取正、取整、同宽）。卫星图上有、现在没有的路补上；现在有、卫星图上没有（被楼、绿地占了）的删掉或改短。双车道写 `dash`。
3. **院内支路、楼间通道、人行道**：宽 ≥ 2 m、卫星图看得清的描成 `paving`（line + width）；楼前大片铺装、广场照旧用 `paving`/`plaza`。
4. **停车**：成片露天停车场写 `parking`；路边成排的垂直车位写 `stalls`。
5. **地面**：画成铺装、其实是树的地方改回 `wood`/`grass`；反过来也一样。新面和已有面接边时用已有面那条边上的坐标，不留硬边、不留缝。
6. **标线**：校门口、主要十字路口、中轴两侧的路口画斑马线（`zebra`，宽 4 m，跨整条车行道）；卫星图上看得见停止线、减速带的照描。看不见的不画。
7. **单车棚**：卫星图上看得见的成排单车、电动车棚描进 `bikeRacks`（有棚写 `covered`）。
8. **楼门**：`--list` 里门数为 0 的楼，每栋至少写一个正门（`main: true`）。位置按卫星图：雨棚、台阶、门前铺装、路的尽头正对的墙；视频截图上看到门的，按截图定门头 `canopy`。看得清的侧门也写。实在看不出的楼不写，在档案里写原因。
9. 楼占地明显不对的（已知问题里列的，或者 check 上红线和墙脚差 > 2 m 的），修 `shift`、或 `drop` 后在 `newBuildings` 重描墙脚。

## 数据格式

```json
{"kind":"asphalt","line":[[-120,420],[-120,600]],"width":7,"dash":true}
{"kind":"paving","line":[[-100,450],[-60,450]],"width":3}
{"kind":"zebra","from":[-124,500],"to":[-116,500],"width":4}
{"from":[-90,470],"to":[-90,482],"covered":true}
{"at":[-157.25,500.9375],"facing":"E","main":true}
```

## 验收

- [ ] `npm run map && npm run art && npm run typecheck && npm test` 全部通过
- [ ] `npm run compare -- -588 615 708 820 2`：车行道、支路、停车场、绿地和卫星图一一对得上；「已知问题」逐条解决
- [ ] `node tools/looks.ts --list 615 820`：门数为 0 的楼只剩档案里写了原因的
- [ ] 回复里列出：改了多少条路、新增多少面、斑马线、单车排、楼门；新描或重描了哪几栋楼；记了哪些「待核实」
