# 像素东大 · Pixel NEU

在像素风的东北大学南湖校区里走走，碰见同样在线的人，挥个手、说句话。

> 谜团 mituan 开发的个人非官方作品，与东北大学没有隶属或授权关系。

## 玩法

- 方向键 / WASD 走路，点地面自动寻路
- `1`–`6` 发表情，`T` 选预设短语，`M` 开关小地图
- 不用注册，没有自由聊天
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

更新：`npm run build` → `dist/` 同步到网页目录，`dist-server/` 同步到 `/srv/pixel-neu/server/`；地图变了再复制 `assets/map.json` → `systemctl restart pixel-neu`。

## 许可

- 代码与美术 © 谜团 mituan，保留所有权利
- 地图数据 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 贡献者，ODbL
- 字体 [Fusion Pixel](https://github.com/TakWolf/fusion-pixel-font)，OFL-1.1
