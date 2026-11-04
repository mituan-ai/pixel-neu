# TASK-40：给看不出门的校内楼推断正门

## 目标

照片、视频截图、卫星图都看过了，还有约 100 栋校内楼看不出门。按 `docs/mapping.md`「推断门」的规则，给每栋推断一个正门，标 `guess: true`，人走到楼前知道从哪进。

## 范围

`node tools/looks.ts --list` 里门数为 0 的楼。已经有门的楼一律不动。

## 依据

- 规则：`docs/mapping.md`「楼的外观」第 5 条下的「推断门」，照着做，不另起规则
- 楼基：和地图生成同一份（`tools/buildings.ts` 的 `loadBuildings`，`tools/looks.ts` 里 `models()` 的写法）
- 车行道和广场：`data/survey.json` 的 `areas`（`asphalt` 是车行道，`plaza`、`paving` 的大面是广场）

## 相关文件（只读）

- `AGENTS.md`、`docs/mapping.md`
- `tools/survey.ts`（`doors`，`guess` 字段）、`tools/buildings.ts`、`tools/looks.ts`、`tools/shape.ts`（`inShape`、`inPoly`）

## 可以改的文件

- `data/survey.json`：`doors` 末尾追加推断门
- `docs/refs/buildings*.md`：对应楼那一行的门记「推断」

不加工具：写一个一次性脚本放在仓库外（例如 `/tmp`），用它算门的位置，结果追加进 `survey.json`，脚本不进仓库。

## 步骤

1. 脚本：对每栋零门楼，取楼基像素的外轮廓，找出朝东南西北四个方向的墙段（`facing`）。
2. 每段墙算它的长度、中点，以及从中点往外到最近的 `asphalt` 或大块 `plaza`/`paving`（≥ 200 m²）的距离（往外每 1 m 取样，最远 80 m）。
3. 按规则选墙：离路最近的长边；一样近（差 < 3 m）取南；L 形、U 形楼取最长那段。中点正对外挂楼梯（`features` 的 `stair`）、或往外 2 m 内就是别的楼的，沿墙挪 4 m，还不行取这面墙上第二长的段。
4. 门：`at` 是墙脚线上那一点（取整到 0.5 m），`facing` 朝外，`main: true`、`canopy: "none"`、`guess: true`。
5. 抽 10 栋跑 `node tools/looks.ts <编号>` 看样张：门在墙上、朝路。不对的查脚本，不要手改个别楼。

## 数据格式

```json
{"at":[-157,500.5],"facing":"E","main":true,"canopy":"none","guess":true}
```

## 验收

- [ ] `npm run map && npm run art && npm run typecheck && npm test` 全部通过
- [ ] `node tools/looks.ts --list`：门数为 0 的校内楼为 0（推断不出来的列在回复里，说明原因）
- [ ] 抽查的 10 栋样张：门都在朝路那面墙上，没有落在楼梯、别的楼贴着的墙上
- [ ] 回复里列出推断了多少栋，按朝向各几栋，以及抽查的楼编号
