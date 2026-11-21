# 参与贡献

欢迎一起把像素东大做得更好。现在最缺的是美术：楼的立面、路灯和长椅这类物件、树、人物的发型和衣服。代码、地图校对、资料考证也同样欢迎。

## 从哪里开始

- **画美术**：看 [art/CONTRIBUTING.md](art/CONTRIBUTING.md)，画好放进 `art/` 提 PR。不用懂代码。
- **校对地图**：发现楼、路、树、门的位置或样子不对，开 issue 写清位置和依据（照片链接、拍摄时间、相机朝向）。描图规则见 [docs/mapping.md](docs/mapping.md)，已登记的资料见 [docs/sources.md](docs/sources.md)。
- **写代码**：待办清单在 [docs/roadmap.md](docs/roadmap.md)。较大的改动先开 issue 说一下想法，免得白做。

[AGENTS.md](AGENTS.md) 是项目约定的总表（比例、方向、目录、技术约定），人和 AI 编程助手都按它来。

## 本地运行

需要 Node.js 22.18+。

```bash
npm install
npm run server   # 联机服务端，开发模式：短信验证码打印在日志里
npm run dev      # 前端，浏览器打开终端里提示的地址
```

改了地图或美术生成器（`tools/`）：

```bash
npm run map && npm run art && npm test
```

然后看 `data/preview.png`，再重启服务端。

描图要对照卫星图：`npm run sat` 抓到 `data/` 下，只留在本地。天地图来源要自己申请 Key，写进 `.env.local` 的 `TIANDITU_TK`。

## 规则

- **按真实资料画**：资料里没有的不画、不起名、不写介绍；地标介绍每句话都要标来源编号。细则见 AGENTS.md「真实性」。
- **照片和卫星图不进仓库**：它们只作参考，PR 里贴链接就行。
- 不画校徽和学校官方标识。本项目是非官方作品，不暗示学校授权。
- 代码：Node 直接跑 `.ts`（类型擦除），不能用 enum、namespace、参数属性、装饰器；导入写 `.ts` 后缀。
- 提交前跑 `npm run typecheck && npm test`；涉及画面的改动在浏览器里实际走一遍。
- 提交信息用中文。

## 许可

提交 PR 即表示：内容是你本人创作，或你有权提交；并同意按本仓库的许可发布，代码和文档 MIT，美术 CC-BY 4.0，地图数据 ODbL 1.0（分界见 [README](README.md#许可)）。第三方素材只收 CC0、CC-BY、OGA-BY、CC-BY-SA，PR 里写明链接、作者和许可证。
