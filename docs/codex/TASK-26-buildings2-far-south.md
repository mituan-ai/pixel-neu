# TASK-26：最南片校内楼第二轮精修（中心 y ≥ 820）：视频截图和组团参照

## 目标

第一轮（TASK-15～18）因为没照片，最南片大部分楼还是中性立面。这一轮用 TASK-22 建好的视频截图索引，把有截图的楼逐栋写上外观；仍然没有截图的楼，按「组团参照」兜底。做完后这一片尽量不再有中性立面，留下的每一栋都在档案里写明原因。

## 范围

`node tools/looks.ts --list 820 2000` 列出的楼。别的分区的楼一律不动（另外三张任务单同时在做）。

## 依据（按优先级，后面的和前面的冲突以前面的为准）

1. **照片和视频截图**：`docs/refs/video.md`（截图索引：哪张截图是哪栋楼的哪一面、看到了什么），截图在 `data/ref/video/`；`docs/refs/buildings.md`、`docs/refs/buildings-far-south.md` 里已有的照片。层数数截图上的窗排。
2. **卫星图**：`npm run check -- 2025-07-31 <楼框外扩 10 m> 8` 和 `2026-10-29` 两期：量墙脚、门的位置（雨棚、台阶、门前铺装）、外挂楼梯，看屋面颜色和坡顶。
3. **组团参照**（兜底，尽量不用）：前两条都定不了立面的楼，按 `docs/mapping.md`「组团参照」一条写 `like`。

## 相关文件（只读）

- `AGENTS.md`；`docs/mapping.md` 的「楼的外观」（判断顺序、资料优先级、组团参照）
- `tools/survey.ts`：`Appearance`（含 `like`）、`Feature`、`doors`、`Part` 的写法
- `tools/facades.ts`：楼型目录和每个参数的意思
- `docs/refs/video.md`、`docs/refs/buildings.md`、`docs/refs/buildings-far-south.md`

## 可以改的文件

- `data/survey.json`：只改这一片的楼在 `buildings`、`newBuildings` 里的条目（`storeys`、`parts`、`roof`、`rise`、`look`、`tweak`、`like`、`features`、`name`、`src`），以及落在这一片楼上的 `doors`
- `docs/refs/buildings-far-south.md`：补本轮用到的资料和逐栋记录
- `docs/refs/buildings.md`：只改这一片的楼那几行的「状态」：「已精修」「组团参照」或「没资料，保持中性」（写原因）

不改 `tools/` 下任何文件。需要新楼型、新构件、或者现有参数表达不了的做法（例如一栋楼不同的面做法不同），写进回复，由维护者加。

## 步骤

每栋楼：

1. 查 `docs/refs/video.md` 和档案，看这栋楼有没有截图或照片。
2. **有截图或照片**：
   - 层数：数窗排，写 `storeys`；局部高低不同写 `parts`。
   - 楼型：按墙面材料、颜色和窗型从 `LOOKS` 挑最像的写 `look`，只差墙色、窗宽、开间的写 `tweak`。裙楼和主楼做法不同的，在 `parts` 里给分区写 `look`。
   - 特色构件、门、坡屋顶：照片上能认出来的才写，写法同第一轮（`docs/mapping.md`）。位置从卫星图量，取整到 0.5 m。
   - `src` 追加截图所在视频的 S 号和 R 号。
3. **没有截图和照片**：看同组团（相邻、同年代、平面和层数相近，例如同一排宿舍、同一组教学楼的分翼）里有没有一栋已经有 `look` 并且不是参照来的楼：
   - 有：写 `like: 那栋楼的编号`，`src` 追加「组团参照」和那栋楼的 R 号；档案状态写「组团参照」，并写清楚为什么算同组团。
   - 没有：保持中性，档案写原因。
4. 每改完 3–5 栋，跑一次 `node tools/looks.ts <这几栋的编号>`，打开 `data/looks-sheet.png` 和截图并排比，不像就调参数。
5. 改完这一栋，改档案里那一行的「状态」。

## 验收

- [ ] `npm run typecheck && npm test` 通过（测试会检查 `like` 指向的楼存在、有自己的楼型、不是参照来的）
- [ ] `node tools/looks.ts` 加上这一片所有改过的楼的编号，样张上每栋有截图的楼和截图比：层数对、墙色和窗型对、构件和门在对的墙上
- [ ] `npm run map && npm run art` 通过；`data/preview.png` 上这一片的楼不再是同一种立面
- [ ] 回复里列出：按截图精修了几栋、组团参照几栋、保持中性几栋（各列编号），需要维护者加的楼型或构件
