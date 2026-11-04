# TASK-19：树种、树形变体、成片林地和四季

## 目标

现在全校约 6400 棵树只用 7 张图（`tree-25/30/35/40`、`pine-20/25/30`），林地按 7 m 一棵均匀撒满，每个街区看起来一样，而且四季都是盛夏。做完后：

- 有沈阳校园常见的几种树，每种几个形状变体，同一片里很少看到两棵一模一样的树；
- 林地有疏有密，林缘有灌木，林子里留出空地；
- 落叶树按北京时间的日期换季：春天嫩绿，夏天深绿，秋天变黄变红，冬天只剩枝干；常绿树四季不变。

## 范围

所有树：林地里撒的树、`survey.json` 的 `trees` 和 `treeRows`、`conifer-column` 柱形柏树不动。

## 依据

- 树种：查沈阳和东北大学校园常见树种的公开资料（沈阳市园林绿化、行道树名录、学校新闻里提到的校园树木，例如银杏大道、丁香），登记 S 号。只用查得到的树种。卫星图看不出树种，所以林地按「沈阳校园常见树种」混种，行道树按资料能确认的写。
- 树形和颜色：查各树种的照片，提炼成像素画法（冠形、高宽比、枝干、秋色）。

## 相关文件（只读）

- `AGENTS.md`、`assets/AGENTS.md`（光从屏幕左上来、不画投影、只用色板颜色）
- `tools/art.ts` 里的 `broadleaf()`、`conifer()` 和 `TREES.forEach` 那段：现在的画法
- `tools/map.ts` 里种树的两段（「描过的单棵树」「林地里的树」）
- `src/scene.ts` 的 `trees()` 和物件图片的创建；`src/shadows.ts` 的 `Tree`；`src/ambient.ts` 鸟落树的逻辑
- `shared/sky.ts`（北京时间的写法）

## 可以改的文件

- `shared/flora.ts`（新建）：树种目录
- `tools/art-flora.ts`（新建）：树的画法
- `tools/art.ts`：只改树的那几段，换成调用 `art-flora.ts`
- `tools/tiles.ts`：`TREES` 改成从 `shared/flora.ts` 生成，或删掉改用目录
- `tools/map.ts`：只改种树的两段
- `tools/survey.ts`、`data/survey.json`：`treeRows` 加可选的 `species`；有资料的行道树写上树种
- `tools/palette.ts`：在末尾加「树木」一节放新颜色
- `src/scene.ts`：`trees()` 和树的贴图按季节选帧
- `tests/catalog.test.ts`：加一条检查，目录里每个树种、尺寸、变体、季节在 props 图集里都有

## 步骤

1. **目录** `shared/flora.ts`：

   ```ts
   export interface Species {
     id: string;            // 'poplar'，只用小写字母
     name: string;          // '杨树'
     kind: 'broad' | 'conifer' | 'shrub';
     evergreen: boolean;
     sizes: number[];       // 冠幅半径，分米，例如 [25, 30, 35, 40]
     variants: number;      // 每个尺寸几种形状，2–4
     height: number;        // 树高 / 冠幅半径，给投影用
     crown: number;         // 冠心高 / 冠幅半径
   }
   export const SPECIES: Species[] = [...];
   /** 北京时间某天的季节；落叶树用，常绿树永远 summer */
   export function season(t: Date): 'spring' | 'summer' | 'autumn' | 'winter';
   /** 贴图名：'poplar-30-1'，非夏季的落叶树加后缀 '~autumn'、'~winter'、'~spring' */
   export function treeFrame(species: string, size: number, variant: number, s: Season): string;
   /** 从贴图名解析出树种、尺寸、变体；不是树返回 null */
   export function parseTree(name: string): { species: Species; size: number; variant: number } | null;
   ```

   季节交界按沈阳物候查资料定（大致：4 月中发芽、5 月中转深绿、9 月底变色、11 月上旬落光），写在 `season()` 的注释里并标来源。

2. **画法** `tools/art-flora.ts`：每个树种一个画法函数 `(R 米, 变体, 季节) => PropArt`，沿用 `broadleaf()`、`conifer()` 的锚点、描边、明暗和尺寸规则。至少要有：
   - 两种针叶（例如油松：冠顶平展、枝层分明；云杉：窄塔形）；
   - 三到四种阔叶（例如杨树：高瘦柱形；柳树：下垂枝条；榆或槐：圆冠；银杏：卵形冠、秋天金黄）；
   - 一种灌木（低矮团状，冠幅半径 8–15 分米），用在林缘和楼前。
   - 冬季落叶树画出主干和分枝，枝梢用一两个像素点，留出透空。秋季按树种用黄、橙、红，叶团里混一点残绿。
   - 变体靠随机种子改冠形（偏心、缺口、几团叶的位置），不靠整体缩放；再加水平翻转作为另一个变体。
3. **种树** `tools/map.ts`：
   - 林地：用低频噪声分出「密林、疏林、空地」三档（空地不种，疏林 10–12 m 一棵，密林 5–6 m 一棵），树种按噪声成片（同一片以一两个树种为主，夹杂别的），林缘 2–4 m 内放灌木。
   - 单棵树和行道树：`treeRows` 有 `species` 的按它种，没有的整排用同一个树种（按位置哈希挑一个阔叶树种），同一排变体轮换。
   - 地图物件的名字写夏季贴图名（`poplar-30-1`），季节由客户端换。
4. **客户端** `src/scene.ts`：
   - `trees()` 用 `parseTree()` 取冠幅和高度，`conifer-column` 照旧。
   - 创建树的图片时按 `season(new Date())` 选帧；跨天时（场景已有按北京时间日期刷新的地方）换帧。图集里没有这一季的帧就用夏季帧。
5. **测试**：`tests/catalog.test.ts` 加一条：`SPECIES` 里每个树种、尺寸、变体、需要的季节，在 `assets/props.json` 里都有对应的帧；树的帧只用色板颜色。

## 约束

- `assets/props.png` 宽不超过 2048、高不超过 2048，文件不超过 600 KB。超了就减少尺寸档或变体数。
- 树的锚点在树干脚下，冠幅和投影的大小要和 `flora.ts` 的 `height`、`crown` 一致（`src/shadows.ts` 按这两个数画投影）。
- 不改鸟落树、投影、雪地的逻辑，只改它们取树的方式。

## 验收

- [ ] `npm run map && npm run art && npm run typecheck && npm test` 通过
- [ ] 树的联系表 `data/trees-sheet.png`（在 `tools/art.ts` 里照 vehicles 的联系表写法加一张，只放树，每行一个树种、按季节分列）上每个树种、每个季节一眼能分出来
- [ ] `data/preview.png` 上林地有疏有密、有空地，同一片林子以一两个树种为主；行道树整排同种
- [ ] `npm run dev` 打开游戏，把系统日期分别改到 1 月、4 月底、7 月、10 月中（或者临时改 `season()` 的输入），树的样子对应换季；投影位置和树冠对得上
- [ ] 回复里列出：树种和来源、props.png 的尺寸和大小、林地里树的总数（和原来约 6400 比）
