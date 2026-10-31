# AGENTS.md

像素东大 · Pixel NEU：东北大学南湖校区的像素风多人校园漫游。浏览器里打开就能玩，玩家在校园里走动、碰面，用表情和预设短语打招呼。谜团 mituan 开发，非官方作品。

## 最重要的规则：真实，不编造

- 校园布局只能来自可查证的资料：OpenStreetMap、卫星图、公开的校园平面图和照片。不做实地测绘，也不凭印象画。
- 资料里查不到的东西，不画、不起名、不写介绍。宁可留白或用中性占位，也不编一栋楼、一个名字或一段校史。
- 为了好玩补充的细节（铺装纹理、草坪、树、路灯、长椅）在代码里标 `DESIGN`，并写明依据。它们不能改变楼、路、门、纪念物的位置。
- 地点介绍（POI）的每句话都要有来源，来源编号登记在 [docs/sources.md](docs/sources.md)。新增来源先登记，再引用。
- 拿不准的条目写进 [docs/design.md](docs/design.md) 的「待核实」，不要悄悄猜一个。

## 目录（保持扁平，不要再往下分层）

```
assets/   运行时资源，Vite 的 publicDir。美术规范见 assets/AGENTS.md
data/     原始资料：osm.json（Overpass 抓取，ODbL）。preview.png 是生成的全图预览，不进仓库
docs/     design.md（投影、比例、设计取舍、待核实、扩展指南）、sources.md（资料来源登记）
server/   Colyseus 服务端：main.ts 启动，room.ts 房间逻辑
shared/   前后端和工具共用：world.ts（比例、碰撞、寻路）、social.ts（外观、表情、短语）、state.ts（同步状态）
src/      浏览器端：main.ts 入口，scene.ts 场景，avatar.ts 角色，net.ts 联机，ui.ts 界面，style.css
tests/    Vitest
tools/    生成器：osm.ts 抓数据，map.ts 生成地图，art*.ts 生成美术，pix.ts / palette.ts 是画布和调色板
```

新文件先想能不能放进现有目录。只有现有目录都不合适时才新建，并在这里登记。

## 常用命令

```
npm run dev        前端开发服务器（Vite，/colyseus 代理到 2567）
npm run server     服务端（node 直接跑 TS，改代码自动重启）
npm test           测试
npm run typecheck  类型检查
npm run build      类型检查 + 打包到 dist/
npm run osm        重新抓 OSM 数据到 data/osm.json（走 curl，遵循 https_proxy）
npm run map        data/osm.json → assets/map.json
npm run art        生成美术到 assets/，并输出 data/preview.png
```

改了地图或美术生成器后，依次跑 `npm run map && npm run art && npm test`，看一眼 `data/preview.png`。服务端启动时读 `assets/map.json`，地图变了要重启服务端。

## 技术约定

- Phaser 4（WebGL、`pixelArt`、`roundPixels`），Colyseus 0.18（`@colyseus/core` + `@colyseus/sdk`），TypeScript 7，Vite 8，Vitest 5。
- Node 22.18+ 直接运行 `.ts`（类型擦除）：不能用 enum、namespace、参数属性（`constructor(private x)`）、装饰器。Schema 用 `schema()` + `t` 写法。
- 导入写 `.ts` 后缀，类型导入用 `import type`。
- 世界常量（格子大小、比例、步速、碰撞盒、图层名）只在 `shared/world.ts` 定义，客户端、服务端、工具都从这里取。
- 服务端是位置的权威：校验速度和碰撞，不合理就发 `snap` 拉回。客户端只做预测。
- 地图是生成产物。不要手改 `assets/map.json`，改 `tools/map.ts` 再重新生成。

## 社交与安全

- 只有预设短语和表情，没有自由文本聊天。新增短语追加到 `shared/social.ts` 的数组末尾，不要插入或删除中间项，因为序号就是网络协议。
- 昵称经过 `cleanName` 清洗（去控制字符、限长）。不收集任何个人信息，不需要登录。
- 单个房间上限 40 人，满了 `joinOrCreate` 会自动开新房间（界面上叫「平行校园」）。

## 署名与许可

- 作品署名「谜团 mituan」，界面和文档都写明「非官方作品」。可以使用「东北大学」校名描述地点，但不使用校徽或学校官方标识，也不暗示学校授权。
- 地图数据 © OpenStreetMap 贡献者（ODbL），界面右下角必须保留署名。
- 字体 Fusion Pixel（OFL-1.1），许可证随字体放在 `assets/fonts/`。
- 校园照片只作为画图参考，不放进仓库，也不在游戏里展示。

## 提交前

`npm run typecheck && npm test`，涉及画面的改动在浏览器里实际走一遍。提交信息用中文，说清楚改了什么、为什么。
