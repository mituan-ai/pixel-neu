# TASK-17：南片校内楼逐栋精修（中心 y 615–820）

## 目标

南片约 35 栋校内楼，逐栋按照片写外观：层数、楼型、特色构件（外挂楼梯、镂空、架空层、花格、通高玻璃、柱廊、饰面）、门洞和门头、坡屋顶。做完后在游戏里走过这一片，每栋有照片的楼都能和实物对上，不再是同一种白墙方窗。

## 范围

`node tools/looks.ts --list 615 820` 列出的楼。别的分区的楼一律不动（另外三张任务单同时在做）。

## 依据

- `docs/refs/buildings.md`：TASK-14 建的楼档案和资料（R-bld-xx），先从这里找每栋楼的照片和建议楼型。
- 档案里没有、但能找到的新照片：学校官网、新闻稿、学院主页、校园视频截图、百科、街景说明。登记在 `docs/refs/buildings-south.md`（新建，格式照抄 `docs/refs/buildings.md`，编号 `R-south-01` 起）。
- 卫星图：`npm run check -- 2025-07-31 <楼框外扩 10 m> 8` 和 `2026-10-29` 两期，量墙脚、门的位置（雨棚、台阶、门前铺装）、外挂楼梯的位置。

## 相关文件（只读）

- `AGENTS.md`；`docs/mapping.md` 的「粗细原则」和「楼的外观」（判断顺序和取舍，照着做）
- `tools/survey.ts`：`Appearance`、`Feature`、`doors`、`Part` 的写法
- `tools/facades.ts`：楼型目录和每个参数的意思
- `docs/refs/buildings.md`

## 可以改的文件

- `data/survey.json`：只改这一片的楼在 `buildings`、`newBuildings` 里的条目（`storeys`、`parts`、`roof`、`rise`、`look`、`tweak`、`features`、`name`、`src`），以及落在这一片楼上的 `doors`
- `docs/refs/buildings-south.md`（新建）
- `docs/refs/buildings.md`：只改这一片的楼那几行的「状态」，改成「已精修」或「没资料，保持中性」

不改 `tools/` 下任何文件。需要新楼型、新构件、或者现有参数表达不了的做法，写进回复，由维护者加。

## 步骤

每栋楼：

1. 看档案和照片。没有照片的楼：只核对层数（卫星图投影粗估，记「待核实」），保持中性立面，跳到下一栋。
2. 层数：数照片上的窗户排数，写 `storeys`。局部高低不同的写 `parts`（形状描墙脚，层数按照片）。
3. 楼型：照档案的「建议楼型」写 `look`，只差墙色、窗宽的写 `tweak`（例如 `"tweak":{"win":2.1,"wall":["ochre0","ochre1","ochre2"]}`）。裙楼和主楼做法不同的，在 `parts` 里给那个分区写 `look`。
4. 特色构件：照片上能认出来的才写 `features`。`from`、`to` 是墙脚线上的两点（世界米坐标，从卫星图量，取整到 0.5 m），`face` 是这面墙朝外的方向，`storeys` 是 `[起层, 止层]`（首层是 0）。
5. 门：正门和主要侧门写进 `doors`（`at` 落在墙脚线上，`facing` 朝外，正门 `main: true`），门头按照片写 `canopy`，门洞特别宽、特别高的写 `width`、`height`。已有的门核对位置，不对就改。
6. 坡屋顶：照片或卫星图上是坡顶的写 `roof`（`gable` 或 `hip`）和 `rise`；屋面颜色不是灰色的写 `tweak.roof`。
7. 每改完 3–5 栋，跑一次 `node tools/looks.ts <这几栋的编号>`，打开 `data/looks-sheet.png` 和照片并排比，不像就调参数。
8. 改完这一栋，把档案里那一行的「状态」改掉。

## 数据格式

```json
"108409762": {"storeys":5,"name":"逸夫教学楼","src":"S1,S30,S37","look":"ribbon","tweak":{"bay":1.8},"features":[{"kind":"glass","face":"S","from":[120,640],"to":[126,640]},{"kind":"stair","face":"E","from":[150,612],"to":[150,618],"storeys":[0,4]}]},
```

```json
{"at":[123,640],"facing":"S","main":true,"canopy":"portico","width":4},
```

## 验收

- [ ] `npm run typecheck && npm test` 通过
- [ ] `node tools/looks.ts` 加上这一片所有改过的楼的编号，样张上每栋楼和照片比：层数对、墙色和窗型对、构件和门在对的墙上
- [ ] `npm run map && npm run art` 通过；`data/preview.png` 上这一片的楼不再全是同一种立面，构件和门头没有画到墙外或别的楼上
- [ ] `docs/refs/buildings.md` 里这一片每栋楼的状态都改过；每个用到的资料都有 R 号
- [ ] 回复里列出：精修了几栋、保持中性几栋、需要维护者加的楼型或构件
