// 界面图标目录：图集 assets/ui.png + ui.json（tools/art-ui.ts 生成）。名字就是图集键。
// 图标 16×16，面板皮肤是九宫格，角块大小见 SKIN_CORNER。

export const ICONS = [
  // 操作
  'chat', 'send', 'emote', 'menu', 'close', 'back', 'map', 'share', 'login', 'logout', 'group', 'settings',
  'report', 'block', 'people', 'pin', 'rotate-left', 'rotate-right', 'zoom-in', 'zoom-out', 'sound-on', 'sound-off', 'help',
  // 天气：实况天气归成这几类
  'sunny', 'clear-night', 'cloudy', 'cloudy-night', 'overcast', 'rain-light', 'rain-heavy', 'thunder', 'snow', 'sleet', 'fog', 'haze',
  // 月相：0 新月、2 上弦、4 满月、6 下弦
  'moon-0', 'moon-1', 'moon-2', 'moon-3', 'moon-4', 'moon-5', 'moon-6', 'moon-7',
  // 天空条上的日、月小图
  'sun-disc', 'moon-disc',
] as const;
export type IconName = (typeof ICONS)[number];

export const ICON_SIZE = 16;

/** 九宫格皮肤：整张 24×24，四角 8×8 不拉伸 */
export const SKINS = ['panel', 'button', 'button-down', 'button-primary', 'bubble', 'tab', 'tab-on'] as const;
export const SKIN_SIZE = 24;
export const SKIN_CORNER = 8;
