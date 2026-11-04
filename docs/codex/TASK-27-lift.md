# TASK-27：悬空体积（楼洞、连廊、风雨廊）

## 目标

楼可以有「底不着地」的部分：体积从离地 `lift` 米起到墙顶。用它画楼洞（穿过楼的过道）、两栋楼之间的架空连廊和贴地风雨廊。底下的地面照常显示，人能从底下走过去。规则已写进 `docs/mapping.md`「楼洞和连廊」。

这张单只做引擎和样张，不往 `data/survey.json` 里描真实的楼洞和连廊（后续分片任务做）。

## 范围

只改 `tools/` 下列出的文件和测试。不动 `src/`、`server/`、`shared/`。

## 相关文件（只读）

- `AGENTS.md`、`docs/mapping.md`「楼洞和连廊」
- `tools/survey.ts`：`Part`、`Survey.buildings`、`Survey.newBuildings`
- `tools/buildings.ts`：`partOf`、`loadBuildings`、`heights`（每像素屋面高度）
- `tools/art-building.ts`：`renderBuilding`（按每像素高度挤出：先画屋顶，前面像素更矮就往下画立面）、`rotateArr`
- `tools/map.ts`：楼基落地材质（约 108–113 行，`MAT.floor`）、楼的碰撞（约 269–271 行）、`heights.png`（约 390–405 行）
- `tools/looks.ts`：样张里的假楼和 `features` 写法（约 60–75 行）
- `tests/` 里检查 survey.json 的测试（`grep -rn "tweak" tests/` 找）

## 可以改的文件

- `tools/survey.ts`：`Part` 加 `lift?: number`；`buildings` 和 `newBuildings` 条目的类型加 `lift?: number`（和 `height` 并列）；注释各一句
- `tools/buildings.ts`：`PartModel` 加 `lift`（像素），`partOf` 读它；新增导出函数 `lifts(b)`，返回每像素的底高（像素），和 `heights(b)` 同形
- `tools/art-building.ts`：`renderBuilding` 按底高画
- `tools/map.ts`：碰撞和落地材质按底高
- `tools/looks.ts`：样张加两栋：一栋带楼洞，一栋连廊
- `tests/` 里检查 survey.json 的那个测试文件：加 `lift` 检查

## 步骤

1. **数据**：`lift` 单位米，`partOf` 里换成像素 `Math.round(lift * PPM)`，不写是 0。整栋楼写 `lift`（连廊）就是第 1 分区的 lift；`parts` 里写的只管自己那个分区。
2. **`lifts(b)`**：每个像素取它所在分区的 `lift`。
3. **渲染**（`renderBuilding`）：旋转底高数组，和 `Hh` 一样用 `rotateArr`；记 `lo(x, y)`。
   - 屋顶照旧。
   - 立面：现在画 `yg` 从 `front` 到 `hh`。改成只画 `yg >= lo(x, y)` 的部分；`lo` 以下不画（透明，露出地面：楼洞的两侧是旁边不悬空的像素自己画到地面的墙，自然成了洞边，不用另画）。在 `yg = lo - 1` 画一排 `ink` 当底沿（楼洞的过梁、连廊的底板）。
   - `front` 的判断：前面那个像素悬空时（它的 `lo > 0`），挡不住后面像素的下半截，算 `front` 时把它当高度 0。
   - 门（`doorPixel`）和特色构件只在 `yg >= lo` 时画。
4. **碰撞**（`map.ts`）：楼基像素的底高 ≥ 2.4 m（`2.4 * PPM` 像素）就不设 solid、不铺 `MAT.floor`，地面保持 survey 里描的材质。
5. **投影高度**（`heights.png`）不改：悬空部分按实心投影，在回复里说明。
6. **样张**（`looks.ts`）：仿照已有的假楼，加：
   - 楼洞：一栋 40 × 14 m、5 层的板楼，中间一条 6 m 宽、南北贯通的分区 `lift: 3.6`；
   - 连廊：样楼是单个模型，就画成一栋 44 × 16 m、4 层的楼，三个分区：西 16 m、东 16 m 照常，中间 12 m 只留南北居中 4 m 宽一条（其余像素不属于楼），这一条 `lift: 7.2`、高 14.4 m。
7. **测试**：`lift` 是数字、≥ 0、小于所在分区或楼的高度（`height`，或 `storeys × 3.6`）。

## 数据格式

```json
{"storeys":5,"parts":[{"poly":[[100,200],[106,200],[106,214],[100,214]],"lift":3.6}]}
{"poly":[[120,300],[132,300],[132,304],[120,304]],"storeys":4,"height":14.4,"lift":7.2}
```

## 验收

- [ ] `npm run typecheck && npm test` 通过
- [ ] `node tools/looks.ts` 的样张四个视角：楼洞那栋四个视角里南北两面都看得到洞口，洞里透出地面、顶上一排暗线，两侧墙和窗正常；连廊底下透出地面，底板一排暗线，两头接在两栋楼墙上
- [ ] `npm run map && npm run art` 通过，`data/preview.png` 上现有的楼和改前一样（survey.json 里还没有 `lift`）
- [ ] 回复里说明：碰撞怎么判、悬空部分的投影没改
