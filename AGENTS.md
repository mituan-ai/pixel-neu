# AGENTS.md

像素东大 · Pixel NEU：东北大学南湖校区的像素风多人校园漫游。谜团 mituan 开发，非官方作品。

## 真实性

- 楼、路、路宽、铺装、草地、树、门、纪念物，位置和尺寸都按 [docs/sources.md](docs/sources.md) 登记的资料：OSM 定楼和路网，卫星图定路宽、地面和树，照片定立面和层数。
- 资料里没有的不画、不起名、不写介绍。某一面立面没有资料，就画中性立面。
- 地标介绍每句话都要标来源编号；新来源先登记再引用。拿不准的写进 sources.md 的「待核实」。
- 照片和卫星图只作参考，不进仓库，也不在游戏里展示。

## 比例与方向

- 全图按真实尺寸，1 m = 8 px：1 格 = 2 m = 16 px，楼高同一比例（一层 30 px）。人物是 Q 版 24×32 帧（`art/chibi/`），按 1 倍显示，全身约 26 px，桌面 2 倍缩放时像素 1:1。
- 显示用整数倍缩放：桌面默认 2 倍，手机默认 1 倍。
- 世界坐标上北（路网转正 3.85°）。客户端可以切四个视角，但旋转只发生在显示层；服务端、碰撞、寻路和网络同步一律用世界坐标、世界方向。
- 全图固定上北，小地图跟随当前视角旋转。
- 世界常量只在 `shared/world.ts` 定义。
- 世界米坐标的原点固定（`tools/geo.ts` 的 ORIGIN），扩图只改 EXTENT，扩出去的地方坐标可以是负数。survey.json 和文档里的坐标永远不用迁移。
- 楼基以卫星图上的墙脚为准，不能直接用 OSM 轮廓：斜拍的楼顶会偏，楼越高偏得越多。每栋楼都要在 survey.json 里写 shift、lean 或确认无偏移，量法见 `tools/survey.ts`。

## 目录

```
art/      公开美术仓库 mituan-ai/pixel-neu-art 的 git 子模块：物件 props/、立面 facades/、Q 版角色底模和发型 chibi/。npm run art 读它们生成 assets/；投稿规范见 art/CONTRIBUTING.md
art-inbox/ 美术草稿与第三方候选素材，审核通过的移到 art/；约束见 art-inbox/AGENTS.md，除该文件外不进仓库
assets/   运行时资源（Vite publicDir），美术约束见 assets/AGENTS.md
data/     原始资料：osm.json（OSM）、survey.json（从卫星图描的地面、树、楼基校正）；sat-*.png、check.png、ref/（照片和视频截图）是本地参考，不进仓库
docs/     sources.md：资料来源与待核实；refs/：各区域参考资料的文字索引；codex/：给 Codex 的通用提示词和任务单
server/   Colyseus 服务端
shared/   前后端和工具共用：world.ts、social.ts、state.ts、view.ts（四视角换算）
src/      浏览器端
tests/    Vitest
tools/    数据抓取与地图、美术生成器
```

新增目录要在这里登记。

## 命令

```
git submodule update --init   拉 art/ 子模块（新克隆时）
npm run dev        前端（Vite，/colyseus 代理到 2567）
npm run server     服务端（带 --dev：放行开发者模式的 Shift 5 倍速；线上用 npm start，不放行）
npm test           测试
npm run typecheck  类型检查
npm run osm        重新抓 OSM 到 data/osm.json
npm run sat        抓卫星图到 data/sat-<来源>.png（-- 来源，见 tools/geo.ts）
npm run check      对照图 data/check.png（-- [来源] x0 y0 x1 y1 每米像素）
npm run map        生成 assets/map.json
npm run art        生成美术，并输出 data/preview.png
```

改了地图或美术生成器：`npm run map && npm run art && npm test`，看 `data/preview.png`，再重启服务端（它启动时读 map.json）。

## 技术约定

- Phaser 4、Colyseus 0.18、TypeScript 7、Vite 8、Vitest 5。
- Node 22.18+ 直接跑 `.ts`（类型擦除）：不能用 enum、namespace、参数属性、装饰器。Schema 用 `schema()` + `t`。导入写 `.ts` 后缀，类型导入用 `import type`。
- 服务端是位置的权威：沿移动路径校验速度和碰撞，不合理就发 `snap`。客户端只做预测。
- `assets/map.json` 是生成产物，改 `tools/` 再重新生成。

## 社交

- 只有预设短语和表情，没有自由文本。`shared/social.ts` 里的短语、表情只能追加到末尾：序号就是网络协议。
- 昵称经过 `cleanName`。不收集个人信息，不需要登录。
- 单房间上限 40 人，满了自动开新房间。

## 署名与许可

- 本仓库（代码、`tools/` 生成的美术、`data/survey.json`）© 谜团 mituan，保留所有权利（`package.json` 为 `UNLICENSED`），仓库不公开。
- `art/` 子模块是公开仓库：原创素材按 CC-BY 4.0 发布，`art/chibi/` 的第三方部件是 CC0。只把别人能贡献的源文件放进去；代码、survey.json、`data/`、`art-inbox/` 草稿和参考照片都不进公开仓库。
- 改 `art/` 先在子模块里提交、推送公开仓库，再在本仓库提交子模块指针。
- 第三方素材只用 CC0、CC-BY、OGA-BY、CC-BY-SA 授权的，逐件登记到 `assets/CREDITS.md`。CC-BY-SA 素材及其改作按 CC-BY-SA 发布，不在保留权利范围内。
- 界面写明「非官方作品」，右下角保留「© OpenStreetMap 贡献者」。不用校徽和学校官方标识，不暗示学校授权。

## 提交前

`npm run typecheck && npm test`，涉及画面的改动在浏览器里实际走一遍。提交信息用中文。
