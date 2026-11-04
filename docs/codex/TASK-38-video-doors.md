# TASK-38：翻第一人称漫游视频找楼门

## 目标

还有约 100 栋校内楼没有门，卫星图上看不出。用一段还没用过的第一人称校园漫游视频逐栋找门，找到的写进 `doors`。找不到的留给下一张单推断，这张单不推断。

## 范围

只处理 `node tools/looks.ts --list` 里门数为 0 的楼。不改楼的外观、层数和地面。

## 依据

- 视频：[第一人称，云逛东北大学南湖校区](https://www.bilibili.com/video/BV1Wvtv65EiS)（2026-09-04，约 24 分钟）。`docs/refs/video.md` 候选表第 03 号，当时没采用是因为部分楼认不准；这次只找门，认不准的楼就跳过。
- 认楼：截图里的门牌、楼名，和卫星图上的楼形、相邻路口、操场、地标对照。`npm run check -- 2025-07-31 <楼框外扩 15 m> 8`
- 下载和抽帧的做法、限制照 `docs/mapping.md`「视频截图」和 `docs/refs/video.md` 开头（`yt-dlp` 限 720p、只下画面；`ffmpeg` 每 2 秒一帧），截图放 `data/ref/video/`，文件名带 R 号和时间点

## 相关文件（只读）

- `AGENTS.md`、`docs/mapping.md`（「楼的外观」第 5 条门、「视频截图」）
- `docs/refs/video.md`：已有视频的登记格式和截图索引格式
- `tools/survey.ts`：`doors`

## 可以改的文件

- `data/survey.json`：`doors`（只加门数为 0 的楼的门）
- `docs/refs/video.md`：登记这段视频（R-vid-05，S 号接 `docs/sources.md` 现有最大编号往下排）和用到的截图
- `docs/sources.md`：登记 S 号；「待核实」
- `docs/refs/buildings*.md`：在对应楼那一行补「门：R-vid-05 某时间点」

## 步骤

1. 登记视频，下载、抽帧。
2. 顺着视频走一遍：每看到一个门口（门洞、门头、台阶、门禁、门牌），先认是哪栋楼。只认得出的才用：有门牌或楼名，或者位置能和卫星图唯一对上（写清凭什么对上）。
3. 认出来的楼如果在零门清单里：在卫星图上量这面墙的墙脚线，门的 `at` 落在墙脚线上（按截图里门在立面上的相对位置估，取整到 0.5 m），`facing` 写朝外方向，正门 `main: true`，门头按截图选 `slab`、`portico`、`none`。
4. 每个门在 `docs/refs/video.md` 截图索引里记一行（截图文件、楼编号、哪一面、看到了什么）。
5. 一栋楼看到几个门就写几个，但侧门只写明显的（有门头或台阶）。

## 数据格式

```json
{"at":[-157.25,500.5],"facing":"E","main":true,"canopy":"slab"}
```

## 验收

- [ ] `npm run map && npm run art && npm run typecheck && npm test` 全部通过
- [ ] `node tools/looks.ts --list`：零门楼比开工前少；新加的门 `node tools/looks.ts <编号>` 看样张，门在截图那面墙上
- [ ] 每个新门在 `docs/refs/video.md` 里都有截图记录
- [ ] 回复里列出：认出几栋楼、加了几个门（楼编号、哪一面、截图时间点）；认不准跳过的大概有几处
