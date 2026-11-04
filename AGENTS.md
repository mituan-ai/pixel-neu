# AGENTS.md

像素东大 · Pixel NEU：东北大学南湖校区的像素风多人校园漫游。谜团 mituan 开发，非官方作品。

## 真实性

- 楼、路、路宽、铺装、草地、树、门、纪念物，位置和尺寸都按 [docs/sources.md](docs/sources.md) 登记的资料：OSM 定楼和路网，卫星图定路宽、地面和树，照片定立面和层数。
- 资料里没有的不画、不起名、不写介绍。某一面立面没有资料，就画中性立面。唯一的例外是楼的立面可以「组团参照」同组团一栋有照片的楼（survey.json 的 `like`），只作兜底，规则见 [docs/mapping.md](docs/mapping.md)。
- 地标介绍每句话都要标来源编号；新来源先登记再引用。拿不准的写进 sources.md 的「待核实」。
- 照片和卫星图只作参考，不进仓库，也不在游戏里展示。

## 比例与方向

- 全图按真实尺寸，1 m = 8 px：1 格 = 2 m = 16 px，楼高同一比例（一层 30 px）。人物是 Q 版 24×32 帧（`art/chibi/`），按 1 倍显示，全身约 26 px，桌面 2 倍缩放时像素 1:1。
- 显示用整数倍缩放：桌面默认 2 倍，手机默认 1 倍。
- 世界坐标上北（路网转正 3.85°）。客户端可以切四个视角，但旋转只发生在显示层；服务端、碰撞、寻路和网络同步一律用世界坐标、世界方向。
- 全图固定上北，小地图跟随当前视角旋转。
- 世界常量只在 `shared/world.ts` 定义。
- 世界米坐标的原点固定（`tools/geo.ts` 的 ORIGIN），扩图只改 EXTENT，扩出去的地方坐标可以是负数。survey.json 和文档里的坐标永远不用迁移。
- 楼基以卫星图上的墙脚为准，不能直接用 OSM 轮廓：斜拍的楼顶会偏，楼越高偏得越多。每栋楼都要在 survey.json 里写 shift 或确认无偏移，量法见 `tools/survey.ts`。lean 只用在 OSM 轮廓把楼顶和露出的立面描在一起的楼上，只描了楼顶的楼用 lean 会把楼切瘦。
- 地面按 1 m = 8 px 逐像素画好，烘焙成 `assets/ground/` 的分块图；碰撞 1 m 一格（`shared/world.ts` 的 `CELL`）。

## 目录

```
art/      公开美术仓库 mituan-ai/pixel-neu-art 的 git 子模块：物件 props/、立面 facades/、Q 版角色底模和发型 chibi/。npm run art 读它们生成 assets/；投稿规范见 art/CONTRIBUTING.md
art-inbox/ 美术草稿与第三方候选素材，审核通过的移到 art/；约束见 art-inbox/AGENTS.md，除该文件外不进仓库
assets/   运行时资源（Vite publicDir），美术约束见 assets/AGENTS.md；ground/ 是 npm run map 烘焙的地面分块
data/     原始资料：osm.json（OSM）、survey.json（从卫星图描的地面、树、楼基校正）；sat-*.png、check.png、parallax.png、ref/（照片和视频截图）是本地参考，不进仓库
docs/     sources.md：资料来源与待核实；roadmap.md：待办清单；design.md：产品设计；mapping.md：描图规则；deploy.md：服务端环境变量与上线；refs/：各区域参考资料的文字索引；codex/：Codex 协作流程、通用提示词和进行中的任务单
server/   Colyseus 服务端
shared/   前后端和工具共用：world.ts、social.ts、state.ts、view.ts（四视角换算）
src/      浏览器端
tests/    Vitest
tools/    数据抓取与地图、美术生成器
```

Codex 的 worktree 在仓库旁边的 `../pixel-neu-codex/`，不在仓库里。

新增目录要在这里登记。

## 命令

```
git submodule update --init   拉 art/ 子模块（新克隆时）
npm run dev        前端（Vite，/colyseus 代理到 2567）
npm run server     服务端（带 --dev：放行 Shift 5 倍速，验证码打印在日志里；线上用 npm start）
npm test           测试
npm run typecheck  类型检查
npm run osm        重新抓 OSM 到 data/osm.json
npm run sat        抓卫星图到 data/sat-<来源>.png（-- 来源，见 tools/geo.ts）
npm run check      对照图 data/check.png（-- [来源] x0 y0 x1 y1 每米像素）
npm run parallax   两期卫星图视差测楼高和楼基，输出建议值和 data/parallax.png（-- x0 y0 x1 y1）
npm run map        生成 assets/map.json、地面分块 assets/ground/ 和小地图 assets/minimap.png
npm run art        生成美术，并输出 data/preview.png
node tools/admin.ts  管理：举报、禁言、封号、删消息（用法见文件开头）
node tools/loadtest.ts  压测：默认 40 个登录机器人加 200 个访客（只对开发库跑，用法见文件开头）
node tools/looks.ts    楼型样张 data/looks-sheet.png；加楼编号看单栋楼四个视角，--list 列校内楼
node tools/codex.ts    把任务单交给 Codex：start / status / check / merge / drop（流程见 docs/codex/PROMPT.md）
```

改了地图或美术生成器：`npm run map && npm run art && npm test`，看 `data/preview.png`，再重启服务端（它启动时读 map.json）。

## 技术约定

- Phaser 4、Colyseus 0.18、TypeScript 7、Vite 8、Vitest 5。
- Node 22.18+ 直接跑 `.ts`（类型擦除）：不能用 enum、namespace、参数属性、装饰器。Schema 用 `schema()` + `t`。导入写 `.ts` 后缀，类型导入用 `import type`。
- 服务端是位置的权威：沿移动路径校验速度和碰撞，不合理就发 `snap`。客户端只做预测。
- 服务端同进程挂了 HTTP 接口（`/api/...`，经 `/colyseus/api/` 代理访问）。环境变量见 [docs/deploy.md](docs/deploy.md)。
- 时间一律按北京时间的真实时刻：日月位置在 `shared/sky.ts`，天气由服务端从 Open-Meteo 取（`server/weather.ts`）。地面投影不烘焙，客户端按太阳位置实时画（`src/shadows.ts`、`assets/heights.png`）。
- 动物和行驶的车在客户端按「北京时间日期 + 编号」生成（`src/ambient.ts`），不走网络；车道取自 OSM 校内机动车道（map.json 的 `lane`）。停着的车和单车是地图物件 `v:车型:车色号`，rot 是车头朝向。
- `assets/map.json` 是生成产物，改 `tools/` 再重新生成。

## 社交

- 没登录是访客：只收状态，不进 `players`，别人看不到，不能发言，不占 40 人名额（每房间另有 60 个旁观位）。
- 登录用手机号短信验证码（`server/auth.ts`），新号码自动注册。短信服务商在 `server/sms.ts` 按 `SMS_PROVIDER` 切换，没配就不开放登录；开发模式（`--dev`）验证码打印在服务端日志里。
- 手机号只存加盐哈希（盐在 `PHONE_SALT`），令牌和验证码只存哈希。数据都在 `node:sqlite` 的库里（`DB_FILE`），聊天记录保留 6 个月。
- 文字聊天分附近（40 m）、广场（跨房间）、讨论室三种频道：每条最多 80 字、2 秒一条，注册不满 10 分钟只能在附近说话；敏感词表在服务端本地（`BADWORDS_FILE`），不进仓库。可以举报、拉黑；管理员用 `node tools/admin.ts` 禁言、封号、删消息。
- 预设短语和表情保留。`shared/social.ts` 里的短语、表情、讨论室只能追加到末尾：序号就是网络协议。
- 聊天内容一律按纯文本显示（`textContent`），不拼 HTML。昵称经过 `cleanName`，消息经过 `cleanText`。
- 改了收集什么数据、存多久，要同步改 `src/legal.ts` 的《隐私政策》。
- 社群入口（QQ 群）在 `src/config.ts`，二维码放 `assets/community/`。
- 单房间上限 40 人，满了自动开新房间。

## 署名与许可

- 本仓库（代码、`tools/` 生成的美术、`data/survey.json`）© 谜团 mituan，保留所有权利（`package.json` 为 `UNLICENSED`），仓库不公开。
- `art/` 子模块是公开仓库：原创素材按 CC-BY 4.0 发布，`art/chibi/` 的第三方部件是 CC0。只把别人能贡献的源文件放进去；代码、survey.json、`data/`、`art-inbox/` 草稿和参考照片都不进公开仓库。
- 改 `art/` 先在子模块里提交、推送公开仓库，再在本仓库提交子模块指针。
- 第三方素材只用 CC0、CC-BY、OGA-BY、CC-BY-SA 授权的，逐件登记到 `assets/CREDITS.md`。CC-BY-SA 素材及其改作按 CC-BY-SA 发布，不在保留权利范围内。
- 界面写明「非官方作品」，右下角保留「© OpenStreetMap 贡献者」。不用校徽和学校官方标识，不暗示学校授权。

## 提交前

`npm run typecheck && npm test`，涉及画面的改动在浏览器里实际走一遍。提交信息用中文。
