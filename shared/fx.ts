// 光照和天气特效目录：图集 assets/fx.png + fx.json（tools/art-fx.ts 生成）。名字就是图集键，锚点在中心（雨雪粒子）或落地点（灯光）。
// 光晕用单色网点画（不用半透明），场景里用叠加混合、按时间调透明度。

export const FX = [
  // 灯光：路灯、校门灯照在地上的光斑，窗口透出的光
  'lamp-glow', 'lamp-glow-small', 'door-glow',
  // 雨：三种长度的雨丝，落地溅起的水花三帧
  'rain-0', 'rain-1', 'rain-2', 'splash-0', 'splash-1', 'splash-2',
  // 雪：四种雪花
  'snow-0', 'snow-1', 'snow-2', 'snow-3',
] as const;
export type FxName = (typeof FX)[number];
