# 像素东大 · Pixel NEU

在像素风的东北大学南湖校区里走走，碰见同样在线的人，挥个手、说句话。

> 谜团 mituan 发起的非官方作品，与东北大学没有隶属或授权关系。

开源项目，代码 MIT、美术 CC-BY 4.0。最缺的是美术：楼的立面、物件、树、人物的发型和衣服，欢迎一起画，也欢迎校对地图、写代码。见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 玩法

- 方向键 / WASD 走路，点地面自动寻路；`Q` / `E` 转视角，`-` / `+` 或滚轮缩放
- `Enter` 聊天，`M` 开关全图
- 走到自行车或共享单车旁按 `R` 骑车
- 不登录也能逛（访客别人看不到）；手机号验证码登录后才能出现在地图上、说话
- 一个校园最多 40 人，满了自动分到新的「平行校园」

## 运行

需要 Node.js 22.18+。

```bash
npm install
npm run server   # 联机服务端，端口 2567
npm run dev      # 前端
```

## 部署

线上：https://neu.yhdmt.site （Cloudflare 回源到 8443）。

| 项 | 位置 |
|---|---|
| 网页 | `/var/www/pixel-neu/`（`dist/` 的内容） |
| 联机服务 | `/srv/pixel-neu/server/server.mjs`（`dist-server/` 的内容），systemd `pixel-neu.service`，用户 `pixelneu`，监听 `127.0.0.1:8790`；Node 在 `/srv/pixel-neu/node/` |
| 地图 | `/srv/pixel-neu/assets/map.json`，由服务单元里的 `MAP_FILE` 指定 |
| nginx | `sites-available/pixel-neu.conf` + `snippets/pixel-neu-site.conf`；`/colyseus/` 反代到 8790 并去掉前缀 |
| 证书 | Let's Encrypt，webroot `/var/www/acme`，certbot 自动续期 |

环境变量和上线步骤见 [docs/deploy.md](docs/deploy.md)。

更新：`npm run build` → `dist/` 同步到网页目录，`dist-server/` 同步到 `/srv/pixel-neu/server/`；地图变了再复制 `assets/map.json` → `systemctl restart pixel-neu`。

## 许可

| 内容 | 许可 |
|---|---|
| 代码和文档（`src/`、`server/`、`shared/`、`tools/`、`tests/`、`docs/`、`art/tools/` 等） | [MIT](LICENSE) |
| 美术：`art/` 的素材和 `assets/` 里的图片 | [CC-BY 4.0](art/LICENSE)，署名「像素东大 · Pixel NEU 及贡献者」并附本仓库链接 |
| `art/chibi/` 的 Q 版底模和发型原图 | CC0 1.0，作者见 [art/chibi/README.md](art/chibi/README.md) |
| 地图数据：`data/osm.json`、`data/survey.json`、`assets/map.json` | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)，含 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 贡献者的数据 |
| 字体 [Fusion Pixel](https://github.com/TakWolf/fusion-pixel-font)（`assets/fonts/`） | [SIL OFL 1.1](assets/fonts/OFL-fusion-pixel.txt) |

第三方素材逐件登记在 [assets/CREDITS.md](assets/CREDITS.md)。许可不涉及东北大学的名称和标识，本项目也不使用它们。
