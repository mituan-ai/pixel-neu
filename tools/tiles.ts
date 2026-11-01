// 地面瓦片表 assets/tiles.png 的编排：地图工具按地面类型取瓦片编号，美术工具按同一编号画。
// 加新地面：在 GROUND 里加类型和编号，在 art.ts 的 drawTile 里画出来，两边编号必须一致。

export const TILESET = {
  firstgid: 1,
  columns: 16,
  count: 80,
  /** 草地边缘 16 种（按上右下左四位掩码）：编号 = grassEdge + 掩码 */
  grassEdge: 16,
  /** 路沿石 16 种：编号 = curb + 掩码 */
  curb: 32,
  /** 碰撞图层专用的标记瓦片，不显示 */
  blocked: 15,
  /** 车道中心虚线（画在边缘图层）：竖线在格中、竖线在格左缘、横线在格中、横线在格上缘 */
  lane: [57, 58, 59, 60],
  /** 斜边过渡（画在草地格的边缘图层）：沥青 64–67、铺装 68–71，按被填的角 东北、东南、西南、西北 */
  diag: { asphalt: 64, paving: 68 },
};

/** 建筑的像素尺度（1 m = 8 px）：一层约 3.6 m，底座 0.5 m，女儿墙 0.4 m，右侧投影 1.5 m */
export const BUILDING = { storey: 30, plinth: 4, parapet: 3, shadow: 12 };

/** 林地里的树：名字里的数字是树冠半径（分米），美术和地图都按这个名单 */
export const TREES = ['tree-25', 'tree-30', 'tree-35', 'tree-40', 'pine-20', 'pine-25', 'pine-30'];

/** 地面类型 → 可用的瓦片编号（多个时按格子位置随机挑，打散重复感） */
export const GROUND = {
  grass: [0, 0, 0, 1, 1, 2, 3],
  wood: [53, 53, 54],
  outside: [14],
  paving: [6, 6, 7],
  asphalt: [4, 4, 5],
  /** 第二个是带车位线的 */
  parking: [4, 56],
  water: [11],
  wall: [10],
  flower: [12],
  hedge: [13],
  floor: [51],
  /** 塑胶跑道 */
  track: [72, 73],
  /** 人工草足球场：2 m 宽的深浅条纹 */
  pitch: [74, 75],
  /** 硬地球场（篮球、网球、排球） */
  court: [76],
} as const;
