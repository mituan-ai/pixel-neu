// 地面瓦片表 assets/tiles.png 的编排：地图工具按地面类型取瓦片编号，美术工具按同一编号画。
// 加新地面：在 GROUND 里加类型和编号，在 art.ts 的 drawTile 里画出来，两边编号必须一致。

export const TILESET = {
  firstgid: 1,
  columns: 16,
  count: 64,
  /** 草地边缘 16 种（按上右下左四位掩码）：编号 = grassEdge + 掩码 */
  grassEdge: 16,
  /** 路沿石 16 种：编号 = curb + 掩码 */
  curb: 32,
  /** 碰撞图层专用的标记瓦片，不显示 */
  blocked: 15,
};

/** 建筑的像素尺度：一层 18 像素（人物 24 像素高，约 1.3 层），底座、女儿墙、右侧投影 */
export const BUILDING = { storey: 18, plinth: 4, parapet: 3, shadow: 6 };

/** 地面类型 → 可用的瓦片编号（多个时按格子位置随机挑，打散重复感） */
export const GROUND = {
  grass: [0, 0, 0, 1, 1, 2, 3],
  grassDark: [53, 53, 54],
  park: [48, 49],
  outside: [14],
  outsideRoad: [55],
  paving: [6, 6, 7],
  band: [52],
  sidewalk: [8, 9],
  asphalt: [4, 4, 5],
  zebra: [50],
  water: [11],
  wall: [10],
  flower: [12],
  hedge: [13],
  floor: [51],
} as const;
