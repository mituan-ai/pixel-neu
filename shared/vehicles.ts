// 车辆目录：车型、真实尺寸、车色和帧数。美术按它出图（tools/art-vehicles.ts、tools/art-bikes.ts），场景按它摆车和放行驶车。
// 车辆是校园生态，不进网络协议，可以增删；校车是 art/props/ 里按视角手绘的物件，不在这里。

/** 燃油车挂蓝牌、新能源车挂绿牌，这是像素尺度下最好认的区别 */
export type VehicleGroup = 'fuel' | 'nev' | 'special' | 'moto' | 'bike' | 'share';

export interface VehicleKind {
  id: string;
  name: string;
  group: VehicleGroup;
  /** 车长、车宽、车高（米），按 1 m = 8 px 画 */
  size: [number, number, number];
  /** 车色名，美术里映射到色板；序号就是图集键里的车色号 */
  paints: string[];
  /** 行驶时的车轮帧数；停着用第 0 帧 */
  frames: number;
}

export const VEHICLES: VehicleKind[] = [
  { id: 'sedan', name: '三厢轿车', group: 'fuel', size: [4.7, 1.8, 1.45], paints: ['白', '银', '黑', '蓝'], frames: 2 },
  { id: 'hatch', name: '两厢轿车', group: 'fuel', size: [4.2, 1.75, 1.5], paints: ['白', '红', '银', '蓝'], frames: 2 },
  { id: 'suv', name: 'SUV', group: 'fuel', size: [4.6, 1.85, 1.7], paints: ['白', '黑', '银', '棕'], frames: 2 },
  { id: 'mpv', name: 'MPV', group: 'fuel', size: [5.0, 1.85, 1.8], paints: ['白', '黑', '银'], frames: 2 },
  { id: 'van', name: '面包车', group: 'fuel', size: [4.0, 1.65, 1.9], paints: ['白', '银'], frames: 2 },
  { id: 'pickup', name: '皮卡', group: 'fuel', size: [5.3, 1.85, 1.8], paints: ['白', '黑', '灰'], frames: 2 },
  { id: 'nev-sedan', name: '新能源轿车', group: 'nev', size: [4.8, 1.88, 1.45], paints: ['白', '灰', '黑', '绿'], frames: 2 },
  { id: 'nev-suv', name: '新能源 SUV', group: 'nev', size: [4.75, 1.92, 1.65], paints: ['白', '灰', '蓝', '黑'], frames: 2 },
  { id: 'nev-mini', name: '新能源微型车', group: 'nev', size: [2.9, 1.5, 1.6], paints: ['白', '粉', '绿', '蓝'], frames: 2 },
  { id: 'express-trike', name: '快递三轮车', group: 'special', size: [2.8, 1.2, 1.7], paints: ['绿', '白'], frames: 2 },
  { id: 'sweeper', name: '小型清扫车', group: 'special', size: [3.5, 1.3, 1.9], paints: ['白'], frames: 2 },
  { id: 'ebike', name: '电动自行车', group: 'moto', size: [1.7, 0.65, 1.1], paints: ['白', '黑', '红', '蓝', '粉'], frames: 1 },
  { id: 'emoto', name: '电动摩托', group: 'moto', size: [1.9, 0.7, 1.15], paints: ['黑', '白', '灰'], frames: 1 },
  { id: 'bike-m', name: '自行车（男式）', group: 'bike', size: [1.7, 0.55, 1.0], paints: ['黑', '蓝', '红', '银'], frames: 1 },
  { id: 'bike-f', name: '自行车（女式）', group: 'bike', size: [1.65, 0.55, 1.0], paints: ['白', '粉', '绿', '黑'], frames: 1 },
  { id: 'share-yellow', name: '黄色共享单车', group: 'share', size: [1.7, 0.6, 1.05], paints: ['黄'], frames: 1 },
  { id: 'share-blue', name: '蓝色共享单车', group: 'share', size: [1.7, 0.6, 1.05], paints: ['蓝'], frames: 1 },
  { id: 'share-cyan', name: '青色共享单车', group: 'share', size: [1.7, 0.6, 1.05], paints: ['青'], frames: 1 },
  { id: 'share-e-yellow', name: '黄色共享电单车', group: 'share', size: [1.8, 0.65, 1.1], paints: ['黄'], frames: 1 },
  { id: 'share-e-blue', name: '蓝色共享电单车', group: 'share', size: [1.8, 0.65, 1.1], paints: ['蓝'], frames: 1 },
];

/** 屏幕朝向后缀，顺序同角色朝向 DIR（下、左、右、上）：车头朝屏幕的哪一边 */
export const SCREEN_DIRS = ['d', 'l', 'r', 'u'] as const;

/** 图集 assets/vehicles.json 里的键 */
export const vehicleKey = (id: string, paint: number, dir: number, frame: number) => `${id}-${paint}-${SCREEN_DIRS[dir]}-${frame}`;

/** 目录要求的全部图集键：美术交付和测试都按它核对 */
export function vehicleKeys(): string[] {
  const keys: string[] = [];
  for (const v of VEHICLES)
    v.paints.forEach((_, p) => {
      for (let d = 0; d < 4; d++) for (let f = 0; f < v.frames; f++) keys.push(vehicleKey(v.id, p, d, f));
    });
  return keys;
}
