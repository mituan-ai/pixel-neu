# TASK-14：校内楼的档案和楼型目录

## 目标

把南湖校区校内 157 栋楼逐栋建档：叫什么、干什么用、大概哪年建、有没有能用的照片、外观属于哪一类。按档案补齐 `tools/facades.ts` 的楼型目录，让后面四张分区任务（TASK-15～18）逐栋精修时有楼型可挑。

这张任务**只建档和定楼型**，不逐栋写 survey.json（名字除外，见步骤 4）。

## 范围

`node tools/looks.ts --list` 列出的 157 栋校内楼（中心在校界 OSM way 53573481 内）。校外的楼不管。

## 依据

- 学校公开资料：东北大学官网（neu.edu.cn）各学院、后勤、档案馆、校史馆页面；校园平面图、导航图；新闻稿配图；招生宣传片、学生拍的校园视频截图；百科词条。
- 地图：OSM（`data/osm.json`，36 栋有名字）；卫星图 `npm run check -- 2025-07-31 x0 y0 x1 y1 4` 看屋顶颜色、屋面构件和楼的平面。
- 已有参考：`docs/sources.md`（S 号）、`docs/refs/*.md`（R 号，信息学馆、图书馆、校门、广场、体育场一带已经整理过）。

## 相关文件（只读）

- `AGENTS.md`、`docs/mapping.md`（「楼的外观」一节是判断规则）
- `tools/facades.ts`：楼型的参数和现有的 10 种楼型
- `tools/survey.ts`：`Appearance`、`Feature`、`doors` 的写法
- `docs/sources.md`、`docs/refs/` 下已有的参考索引（照抄它们的表格格式）

## 可以改的文件

- `docs/refs/buildings.md`（新建）：楼的档案
- `tools/facades.ts`：只在 `LOOKS` 里追加楼型、改现有楼型的参数（不改函数）
- `tools/palette.ts`：新楼型需要的颜色追加在「楼型」一节末尾
- `data/survey.json`：只给有可靠来源的楼补 `name` 和 `src`
- `docs/sources.md`：登记新的 S 号、写「待核实」

## 步骤

1. `node tools/looks.ts --list > /tmp/list.md`，拿到 157 栋楼的编号、中心坐标和占地。
2. 先找全校层面的资料：校园平面图（带楼名的）、校园航拍和全景视频、各学院的楼介绍、校史里的建设年表。把每份资料登记成 `docs/refs/buildings.md` 里的 R 号（`R-bld-01`、`R-bld-02`……），表格格式照抄 `docs/refs/library.md`。
3. 逐栋填档案，`docs/refs/buildings.md` 第二张表，每栋一行：
   `| 编号 | 名字 | 用途 | 建成年代 | 照片（R 号，哪几面） | 墙面和窗 | 特色构件 | 建议楼型 | 状态 |`
   - 名字、用途、年代没有来源就留空，不猜。
   - 「墙面和窗」用一句话写照片上看到的：例如「红砖清水墙，白色窗套，点窗，每层一道水泥线脚」。
   - 「特色构件」写照片上能认出来的：外挂楼梯、架空层、镂空、花格、通高玻璃、柱廊、坡屋顶等。
   - 「状态」写：有照片 / 只有卫星图 / 没资料。
4. 名字：校园平面图或官网能确认的楼名，写进 `survey.json` 的 `name`，`src` 写 S 号（R 号先在 `docs/sources.md` 登记成 S 号再用）。OSM 有名字但没有第二个来源的，也要先查到学校资料再写。
5. 楼型：把档案里「墙面和窗」相同的楼归成一类。
   - 能用现有楼型加 `tweak` 表达的，「建议楼型」写成 `tile + tweak{wall: 浅黄}` 这种形式。
   - 三栋以上同一种做法、现有楼型都不像的，在 `LOOKS` 里加一个，注释写依据（哪几栋楼、哪张照片）。新颜色追加到 `tools/palette.ts` 的「楼型」一节。
   - 现有楼型的参数（窗宽、开间、颜色）和照片明显不符的，可以改参数，注释里写依据。
6. 档案最后写一段「分区进度」：按 TASK-15～18 的四个分区（中心 y < 330、330–615、615–820、≥ 820）各列有照片的楼数和没资料的楼数。

## 数据格式

楼型条目（`tools/facades.ts` 的 `LOOKS`）：

```ts
  /** 苏式教学楼：浅黄涂料，白色线脚和窗套，高窗，三段式檐口（据 R-bld-07 冶金学馆北面、R-bld-09 机电学馆） */
  soviet: { ...base, wall: ['ochre0', 'ochre1', 'ochre2'], base: 'stone0', bay: 3.6, win: 1.6, winH: 2.4, sill: 0.8, frame: 'tile2', bands: 'tile2', cornice: 'tile2' },
```

## 验收

- [ ] `npm run typecheck && npm test` 通过
- [ ] `node tools/looks.ts` 的样张里新楼型都画得出来，和依据的照片比，墙色、窗型、窗间距一眼能对上
- [ ] `docs/refs/buildings.md` 有 157 行档案，每行的状态都填了；每个 R 号都有链接和日期
- [ ] survey.json 里新写的 `name` 每个都有 `src`
