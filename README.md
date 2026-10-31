# 像素东大 · Pixel NEU

在像素风的东北大学南湖校区里走走，碰见同样在线的人，挥个手、说句话。

第一片区域是校园中轴：**北门 → 校训石 → 信息学馆 → 大书 → 宁恩承图书馆**。布局按 OpenStreetMap 和公开资料 1:1 还原（1 格 = 2 米），没有编造的楼和地名。

> 谜团 mituan 开发。这是个人的非官方作品，与东北大学没有隶属或授权关系。

## 玩法

- 方向键 / WASD 走路，点一下地面会自动寻路走过去
- `1`–`6` 发表情，`T` 选预设短语，`M` 开关小地图
- 走近地标会弹出介绍，每条介绍都注明了资料来源
- 不用注册，没有自由聊天，只有表情和预设短语
- 一个校园最多 40 人，满了会自动分到新的「平行校园」

## 本地运行

需要 Node.js 22.18 或更高版本。

```bash
npm install
npm run server   # 终端一：联机服务端，端口 2567
npm run dev      # 终端二：打开终端里显示的地址
```

其他命令和开发约定见 [AGENTS.md](AGENTS.md)。地图怎么来的、哪些地方做了取舍、还有什么没核实，见 [docs/design.md](docs/design.md)，资料来源见 [docs/sources.md](docs/sources.md)。

## 部署

`npm run build` 生成静态文件到 `dist/`，由任意静态服务器提供。服务端用 `npm start` 启动，监听 `127.0.0.1:2567`（可用 `PORT`、`HOST` 环境变量修改）。前端默认连接同源的 `/colyseus`，反向代理需要把这个路径（含 WebSocket 升级）转发到服务端，并去掉 `/colyseus` 前缀。

## 致谢与许可

- 地图数据 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 贡献者，按 ODbL 许可使用
- 字体 [Fusion Pixel](https://github.com/TakWolf/fusion-pixel-font)，SIL Open Font License 1.1，许可证见 `assets/fonts/`
- 美术素材由本项目程序生成
- 代码与美术 © 谜团 mituan，保留所有权利
