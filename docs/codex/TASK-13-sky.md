# TASK-13：日月位置、日出日落、月相和天气分类的计算

## 目标

游戏要按北京时间的真实时刻显示太阳、月亮东升西落，影子随太阳转，夜里按月相显示月亮。这张任务单只写计算部分：`shared/sky.ts` 里的一组纯函数，再配上单元测试。画面接入由 Claude 做。

## 范围

只新建 `shared/sky.ts` 和 `tests/sky.test.ts` 两个文件，不碰其他文件。

## 依据

- **地点。** 南湖校区，取 `tools/geo.ts` 里的 LAT0/LON0：北纬 41.7655°，东经 123.4135°。函数里写成常量 `SITE`。注意不要从 `tools/` 导入：`shared/` 会打包进浏览器。
- **算法。** 按公开的天文公式自己实现：
  - 太阳：NOAA 太阳位置算法，或 Meeus《天文算法》的低精度太阳公式。
  - 月亮：Meeus 第 47 章的主要周期项，取前十几项就够。
  - 不要复制第三方库（如 SunCalc）的代码，也不要装依赖。
- **精度要求：**

  | 量 | 允许误差 |
  |---|---|
  | 太阳方位角、高度角 | 0.5° |
  | 日出、日落 | 2 分钟 |
  | 月亮方位角、高度角 | 1.5° |
  | 月出、月落 | 10 分钟 |
  | 月亮被照亮的比例 | 0.03 |

- **基准值。** 下面这些数由 Claude 用 PyEphem 4.2.1 算出。方位角从正北起顺时针，高度角是几何高度（不加大气折射）。日出日落取太阳中心在地平线下 50′ 的时刻（已包含折射和视半径）；月出月落取月亮中心过地平线（0°）的时刻。时间都是北京时间。

  日出日落：

  | 日期 | 日出 | 日落 |
  |---|---|---|
  | 2026-03-20 | 05:49 | 17:59 |
  | 2026-06-21 | 04:09 | 19:26 |
  | 2026-11-02 | 06:17 | 16:41 |
  | 2026-12-21 | 07:08 | 16:20 |

  太阳位置：

  | 北京时间 | 方位角 | 高度角 |
  |---|---|---|
  | 2026-06-21 05:00 | 64.72 | 7.04 |
  | 2026-06-21 12:00 | 188.64 | 71.50 |
  | 2026-06-21 18:00 | 289.71 | 13.27 |
  | 2026-12-21 08:00 | 129.98 | 6.74 |
  | 2026-12-21 12:00 | 183.98 | 24.69 |
  | 2026-12-21 15:30 | 230.30 | 6.52 |
  | 2026-11-02 09:00 | 139.96 | 23.80 |
  | 2026-11-02 14:00 | 220.04 | 23.72 |

  月亮位置和月相（相位角：新月 0°、上弦 90°、满月 180°、下弦 270°）：

  | 北京时间 | 方位角 | 高度角 | 照亮比例 | 相位角 | 月相图标号 |
  |---|---|---|---|---|---|
  | 2026-11-02 21:00 | 40.48 | -23.17 | 0.424 | 278.8 | 6 |
  | 2026-11-10 06:00 | 109.13 | -15.31 | 0.006 | 8.6 | 0 |
  | 2026-11-17 18:00 | 183.94 | 33.87 | 0.495 | 89.2 | 2 |
  | 2026-11-24 22:00 | 125.77 | 65.36 | 0.998 | 175.0 | 4 |
  | 2026-12-01 03:00 | 124.56 | 44.15 | 0.552 | 264.2 | 6 |

  月出月落：

  | 日期 | 月出 | 月落 |
  |---|---|---|
  | 2026-11-02 | 23:38 | 13:10 |
  | 2026-11-17 | 12:34 | 23:06 |

## 相关文件（只读）

- `shared/icons.ts`：天气图标名（`IconName`），`weatherIcon` 的返回值必须是其中之一
- `shared/world.ts`：`shared/` 里文件的写法（注释密度、命名）
- `tests/world.test.ts`：测试的写法

## 可以改的文件

- `shared/sky.ts`（新建）
- `tests/sky.test.ts`（新建）

## 步骤

1. 在 `shared/sky.ts` 里导出下面的函数，签名照抄「数据格式」。
2. `sunTimes`、`moonTimes` 按北京时间的自然日找事件：从当天 00:00 到次日 00:00，用每 10 分钟采样、再二分逼近的方法找过地平线的时刻。当天没有月出或月落时返回 `null`。
3. `moonPhase` 的相位角是月亮和太阳的黄经差，换算到 0–360°；照亮比例是 `(1 − cos 相位角) / 2`；图标号是 `Math.round(相位角 / 45) % 8`。
4. `weatherIcon` 和 `weatherText` 把 WMO 天气码（Open-Meteo 的 `weather_code`）归类，对照表见「数据格式」。表里没有的码按「阴」处理。
5. 在 `tests/sky.test.ts` 里把「依据」里的所有基准值逐条写成测试用例，按上面的允许误差断言。再加上 `weatherIcon` 对照表的每一类各测一个码，昼夜各测一次。

## 数据格式

```ts
export const SITE = { lat: 41.7655, lon: 123.4135 } as const;

/** 方位角从正北顺时针（度），高度角（度，几何高度，不加折射） */
export interface Body { az: number; alt: number }

export function sunPosition(t: Date): Body;
export function moonPosition(t: Date): Body;
/** angle：相位角 0–360（0 新月、180 满月）；illum：照亮比例 0–1；icon：0–7，对应 shared/icons.ts 的 moon-0…moon-7 */
export function moonPhase(t: Date): { angle: number; illum: number; icon: number };
/** day 是这一天里的任意时刻，按北京时间取自然日 */
export function sunTimes(day: Date): { rise: Date | null; set: Date | null };
export function moonTimes(day: Date): { rise: Date | null; set: Date | null };
export function weatherIcon(code: number, night: boolean): IconName;
export function weatherText(code: number): string;
```

| WMO 码 | weatherText | 白天图标 | 夜间图标 |
|---|---|---|---|
| 0、1 | 晴 | sunny | clear-night |
| 2 | 多云 | cloudy | cloudy-night |
| 3 | 阴 | overcast | overcast |
| 45、48 | 雾 | fog | fog |
| 51、53、55、61、80 | 小雨 | rain-light | rain-light |
| 63、81 | 中雨 | rain-heavy | rain-heavy |
| 65、82 | 大雨 | rain-heavy | rain-heavy |
| 56、57、66、67 | 雨夹雪 | sleet | sleet |
| 71、77、85 | 小雪 | snow | snow |
| 73 | 中雪 | snow | snow |
| 75、86 | 大雪 | snow | snow |
| 95、96、99 | 雷阵雨 | thunder | thunder |

## 验收

- [ ] `npm run typecheck && npm test` 全部通过，`tests/sky.test.ts` 覆盖「依据」里的每一个基准值。
- [ ] `shared/sky.ts` 不导入 `tools/` 和 `node:` 开头的模块（浏览器里也要能跑）。
- [ ] 没有新增依赖，没有改别的文件。
