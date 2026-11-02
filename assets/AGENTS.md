# assets/AGENTS.md：美术约束

本目录原样发布到网站根目录（本文件除外）。比例和方向见根目录 AGENTS.md。

- 3/4 俯视：地面正投影，立面按真实高度竖直画在占地上方。
- 地面不用拼贴图块：`tools/ground.ts` 按 survey.json 的形状逐像素铺材质（花纹在 `tools/art-ground.ts`），再切成 512 像素见方的分块图，客户端按视角旋转。
- 立面和物件的明暗按光从屏幕左上方来画，不随视角旋转。地面投影不画进贴图：楼、树、物件都不带投影，场景按太阳方位实时投影（楼按 `heights.png`，树按树冠椭圆）。
- 建筑每栋出 N/E/S/W 四个朝向。立面样式按地理朝向选，没有资料的面用中性立面。
- 带文字的物件（校名牌、校训石）每个朝向单独画，不用镜像代替。
- 人物是 Q 版 24×32：底模和七种发型来自 `art/chibi/`，衣服、鞋和四种短发由生成器按底模轮廓画；四方向、3 帧走路，游戏里按 1 倍显示。部件和选项一一对应，见 `tools/art-avatar.ts` 和 `shared/social.ts`。
- 第三方素材的出处和许可写进 `CREDITS.md`。
- 生成产物（`map.json`、`ground/`、`minimap.png`、`buildings/` 等）不要手改。手绘素材要加进 `tools/art.ts` 的 `HANDMADE`，生成器就不会覆盖它。
- 车辆（`vehicles.png`）、动物（`fauna.png`）按屏幕朝向（下、左、右、上）出图，不按视角；目录在 `shared/vehicles.ts`、`shared/fauna.ts`，`tests/catalog.test.ts` 核对图集和目录一一对应、只用色板颜色。车辆按真实尺寸，动物和人一样按 Q 版比例。两者都不画投影，投影由场景按太阳方向画。
- 界面图标和九宫格皮肤在 `ui.png`，目录在 `shared/icons.ts`。
- 夜景：`buildings/<楼>-<视角>-light.png` 是窗灯蒙版，路灯、门口光斑和雨雪在 `fx.png`（目录 `shared/fx.ts`）。积雪由场景在运行时把草地换成雪色，不另画。
- `icon-192.png`、`icon-512.png`（应用图标）和 `og.png`（分享卡片图）由 `npm run art` 生成。
