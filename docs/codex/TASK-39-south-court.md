# TASK-39：南片内院大楼和周围地面

## 目标

约 x -280–-170、y 615–680 现在是一整块米色铺装，卫星图上是一栋带内院的大楼（TASK-31 登记过，没做完）。描成楼，内院和楼周围的地面按卫星图画。

## 范围

x -290–-160、y 605–690。范围外不动。

## 依据

- `npm run check -- 2025-07-31 -290 605 -160 690 8`，树荫和阴影看不清的地方对照 `2026-10-29`
- `npm run compare -- -290 605 -160 690 4` 复查（左边楼顶按高度往北抬，楼的位置以 check 为准）
- `docs/refs/buildings-south.md`、`docs/sources.md`「待核实」里 TASK-31 关于这栋院落楼的记录；`docs/refs/video.md` 里有没有这一带的截图（定层数和门）

## 相关文件（只读）

- `AGENTS.md`、`docs/mapping.md`（楼基量法、规整化、楼洞和连廊）
- `tools/survey.ts`

## 可以改的文件

- `data/survey.json`：范围内的 `areas`、`newBuildings`、`doors`，范围内 OSM 楼 `buildings` 条目的 `shift`、`drop`、`storeys`、`parts`
- `docs/refs/buildings-south.md`、`docs/sources.md`

## 步骤

1. check 图上看红线：这块有 OSM 轮廓就修 `shift`（楼基以墙脚为准），没有就在 `newBuildings` 里按墙脚描（环形楼描成外轮廓，内院单独挖出来：外轮廓和内院用一个多边形顺序走一圈，或者分成几翼几个多边形）。
2. 层数：有截图数窗排；没有就看和相邻已知层数的楼的投影长短对比估一个，记「待核实」。
3. 内院地面：绿地、铺装、停车按卫星图；楼周围原来那块米色铺装改成卫星图上的实际地面。
4. 卫星图上看得到穿过楼进内院的楼洞的，按 `docs/mapping.md`「楼洞和连廊」写 `parts` + `lift`。
5. 门：看得出的写；看不出的不写（下一张单统一推断）。

## 验收

- [ ] `npm run map && npm run art && npm run typecheck && npm test` 全部通过
- [ ] `npm run check -- 2025-07-31 -290 605 -160 690 4`：楼基和墙脚差在 2 m 内
- [ ] `npm run compare -- -290 605 -160 690 4`：不再有大块米色铺装，内院看得出来
- [ ] 回复里列出楼的编号、层数和依据
