// 本机设置：存在 localStorage，读写失败时用默认值。
export interface Settings {
  /** 画面：跟随真实时间（夜里变暗、亮灯），或始终白天 */
  daylight: 'real' | 'day';
  /** 雨雪粒子 */
  weatherFx: boolean;
}

const KEY = 'pixel-neu:settings';
const DEFAULTS: Settings = { daylight: 'real', weatherFx: true };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

const subs = new Set<(s: Settings) => void>();

export const settings = {
  value: load(),
  set(patch: Partial<Settings>): void {
    this.value = { ...this.value, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* 存不了就只在这次生效 */
    }
    for (const f of subs) f(this.value);
  },
  subscribe(f: (s: Settings) => void): void {
    subs.add(f);
  },
};
