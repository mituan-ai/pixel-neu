// 全项目唯一的调色板。生成的美术只能用这里的颜色；手绘素材用 assets/palette.gpl（npm run art 时导出）。
// 加色前先看能不能用已有的色；确实要加，按色组放进去并在 assets/AGENTS.md 的说明里同步。

export const PAL = {
  // 轮廓与阴影
  ink: 0x2a2433,
  shadow: 0x1d2a3a,

  // 草地与植物
  grass0: 0x3f6e3a,
  grass1: 0x5b8f45,
  grass2: 0x76a650,
  grass3: 0x9cc466,
  leaf0: 0x2c4f34,
  leaf1: 0x3f7043,
  leaf2: 0x5e9450,
  pine0: 0x1f3d36,
  pine1: 0x2f5a48,
  pine2: 0x467a5c,
  trunk: 0x6b4a36,
  hedge: 0x4a7d3f,

  // 铺装与道路
  pave0: 0x9d9585,
  pave1: 0xbdb5a4,
  pave2: 0xd2cbbb,
  pave3: 0xe4dece,
  brick0: 0x8f5a4a,
  brick1: 0xa86f5a,
  brick2: 0xbf8a72,
  asph0: 0x4a4d56,
  asph1: 0x575a63,
  asph2: 0x686b73,
  paint: 0xe8e6df,
  curb: 0xc9c4b8,

  // 墙与石材
  wall0: 0x8a8478,
  wall1: 0xa8a194,
  wall2: 0xc9c3b6,
  stone0: 0x9b9483,
  stone1: 0xbdb6a6,
  stone2: 0xd8d2c4,
  stone3: 0xece8de,

  // 信息学馆：偏灰的米色石材（据近年照片）
  beige0: 0x7f7464,
  beige1: 0xa99d88,
  beige2: 0xcbbfa8,
  beige3: 0xe0d6c2,
  flag: 0xd23a32,

  // 图书馆：浅灰
  grey0: 0x7e8487,
  grey1: 0xa3a8ab,
  grey2: 0xc2c6c8,
  grey3: 0xdcdfe0,

  // 普通建筑与屋顶
  plain0: 0xb5b0a5,
  plain1: 0xd3cfc4,
  plain2: 0xe8e4da,
  // 屋顶是偏暖的混凝土灰，比沥青亮得多（据卫星图 S7）
  roof0: 0x7c7a74,
  roof1: 0xa3a19a,
  roof2: 0xc8c5bc,

  // 玻璃
  glass0: 0x33414f,
  glass1: 0x4f6a85,
  glass2: 0x8eaac2,

  // 水
  water0: 0x3f6f98,
  water1: 0x5a8fbc,
  water2: 0x9cc6e2,

  // 花、铜像、点缀
  flowerR: 0xd94a3f,
  flowerY: 0xf0c94a,
  flowerW: 0xf4f2ec,
  flowerP: 0xe58aa8,
  bronze0: 0x4e3a33,
  bronze1: 0x6e5246,
  bronze2: 0x93715c,
  gold: 0xd8b04a,
  slate: 0x2b3442,
  white: 0xffffff,
  // 运动场：塑胶跑道、硬地球场
  track0: 0x9a4038,
  track1: 0xb4524a,
  court0: 0x4c7b42,
  court1: 0x629353,

  // 角色可染色部件的灰阶（运行时乘以玩家选的颜色）
  tint0: 0x8c8c8c,
  tint1: 0xbdbdbd,
  tint2: 0xe6e6e6,
  tint3: 0xffffff,

  // 刘长春像：S25 的暗灰铜色
  statue0: 0x37403b,
  statue1: 0x536057,
  statue2: 0x6c756d,
} as const;

export type PalKey = keyof typeof PAL;
export type Color = PalKey | number;
