// 天空：按北京时间的真实时刻和实况天气，算出整个世界的色调、灯亮不亮、影子方向和雨雪，交给场景。
// 夜景是「亮夜」：压暗有下限，路和人始终看得清。设置里可以切成「始终白天」。
import Phaser from 'phaser';
import { moonPhase, moonPosition, sunPosition, type Body } from '../shared/sky.ts';
import { FALLBACK_WEATHER, precipLevel, type Weather } from '../shared/weather.ts';
import type { CampusScene } from './scene.ts';
import type { Settings } from './settings.ts';

type RGB = [number, number, number];

/** 几个关键时刻的色调（乘到所有世界物体上） */
const DAY: RGB = [255, 255, 255];
const DAWN: RGB = [255, 214, 222];
const DUSK: RGB = [255, 196, 140];
/** 夜里最暗就到这里（亮夜），满月时再亮一点 */
const NIGHT: RGB = [118, 132, 186];
const MOONLIT: RGB = [146, 158, 204];
/** 阴天、雨、雾再乘一层灰 */
const GREY: Record<string, RGB> = { cloudy: [242, 244, 248], overcast: [214, 220, 230], rain: [196, 204, 218], fog: [222, 224, 226] };

/** 「始终白天」时用的太阳：上午十点左右 */
const FIXED_SUN: Body = { az: 135, alt: 40 };

const lerp = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t)))) as RGB;
const mul = (a: RGB, b: RGB): RGB => a.map((v, i) => Math.round((v * b[i]) / 255)) as RGB;
const toInt = (c: RGB) => (c[0] << 16) | (c[1] << 8) | c[2];

function greyOf(code: number): RGB {
  if (code === 2) return GREY.cloudy;
  if (code === 3) return GREY.overcast;
  if (code === 45 || code === 48) return GREY.fog;
  if (code >= 51) return GREY.rain;
  return DAY;
}

/** 影子浓淡：晴天 1，多云淡一些，阴雨雾没有影子 */
function shadowStrength(code: number): number {
  if (code <= 1) return 1;
  if (code === 2) return 0.55;
  return 0;
}

/** 太阳高度 → 色调。清晨偏粉，黄昏偏橙，日落后转入蓝调 */
export function skyTint(t: Date): { tint: RGB; night: number } {
  const sun = sunPosition(t);
  const morning = sun.az < 180;
  const warm = morning ? DAWN : DUSK;
  let tint: RGB;
  if (sun.alt >= 12) tint = DAY;
  else if (sun.alt >= 0) tint = lerp(warm, DAY, sun.alt / 12);
  else {
    const moon = moonPosition(t);
    const night = moon.alt > 0 ? lerp(NIGHT, MOONLIT, moonPhase(t).illum) : NIGHT;
    tint = lerp(warm, night, -sun.alt / 8);
  }
  // night：0 白天，1 全黑夜；路灯在太阳低于 -2° 时亮
  return { tint, night: Math.min(1, Math.max(0, -sun.alt / 8)) };
}

export class Sky {
  private readonly scene: CampusScene;
  private weather: Weather = FALLBACK_WEATHER;
  private settings: Settings = { daylight: 'real', weatherFx: true };
  private rain?: Phaser.GameObjects.Particles.ParticleEmitter;
  private snow?: Phaser.GameObjects.Particles.ParticleEmitter;
  private splash?: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(scene: CampusScene) {
    this.scene = scene;
    setInterval(() => this.update(), 30_000);
    scene.scale.on('resize', () => this.update());
  }

  setWeather(w: Weather): void {
    this.weather = w;
    this.update();
  }

  apply(s: Settings): void {
    this.settings = s;
    this.update();
  }

  private code(): number {
    return this.weather.stale ? 0 : this.weather.code;
  }

  update(now = new Date()): void {
    const day = this.settings.daylight === 'day';
    const code = this.code();
    const { tint, night } = day ? { tint: DAY, night: 0 } : skyTint(now);
    this.scene.setShade(toInt(mul(tint, greyOf(code))));
    this.scene.setLights(!day && sunPosition(now).alt < -2);
    this.scene.setSnowCover(!this.weather.stale && this.weather.snow > 0);
    const sun = day ? FIXED_SUN : sunPosition(now);
    this.scene.setSun(sun, sun.alt > 1 ? shadowStrength(code) * (1 - night) : 0);
    const wet = precipLevel(code);
    this.scene.setWet(!this.weather.stale && wet.rain + wet.snow > 0);
    const p = this.settings.weatherFx ? precipLevel(code) : { rain: 0, snow: 0 };
    this.particles(p.rain, p.snow);
  }

  /** 雨雪粒子：跟着镜头走，画在世界之上、名字和气泡之下 */
  private particles(rain: number, snow: number): void {
    const s = this.scene;
    if (!s.textures.exists('fx')) return;
    const cam = s.cameras.main;
    const w = cam.width / cam.zoom, h = cam.height / cam.zoom;
    /** 在镜头坐标的矩形里随机取点（发射器每帧挪到镜头中心） */
    const rect = (x: number, y: number, rw: number, rh: number) => ({
      type: 'random' as const,
      source: { getRandomPoint: (p: Phaser.Types.Math.Vector2Like) => ((p.x = x + Math.random() * rw), (p.y = y + Math.random() * rh)) },
    });
    const zone = (pad: number) => rect(-w / 2 - pad, -h / 2 - 40, w + pad * 2, 20);
    if (rain && !this.rain) {
      this.rain = s.add.particles(0, 0, 'fx', {
        frame: ['rain-0', 'rain-1', 'rain-2'],
        speedY: { min: 260, max: 340 },
        speedX: { min: 80, max: 110 },
        lifespan: (h + 60) / 300 * 1000,
        quantity: 1,
      });
      this.splash = s.add.particles(0, 0, 'fx', { frame: ['splash-0', 'splash-1', 'splash-2'], lifespan: 220, quantity: 1, alpha: { start: 1, end: 0 } });
      for (const e of [this.rain, this.splash]) s.addOverlay(e);
    }
    if (!rain && this.rain) {
      this.rain.destroy();
      this.splash?.destroy();
      this.rain = this.splash = undefined;
    }
    if (this.rain) {
      this.rain.setConfig({
        frame: ['rain-0', 'rain-1', 'rain-2'],
        speedY: { min: 260, max: 340 },
        speedX: { min: 80, max: 110 },
        lifespan: ((h + 60) / 300) * 1000,
        frequency: [0, 40, 16, 6][rain],
        quantity: 1 + Math.floor(w / 400),
        emitZone: zone(60),
      });
      this.splash!.setConfig({
        frame: ['splash-0', 'splash-1', 'splash-2'],
        lifespan: 220,
        frequency: [0, 120, 50, 20][rain],
        quantity: 1 + Math.floor(w / 400),
        alpha: { start: 1, end: 0 },
        emitZone: rect(-w / 2, -h / 2, w, h),
      });
    }
    if (snow && !this.snow) {
      this.snow = s.add.particles(0, 0, 'fx', { frame: ['snow-0'], lifespan: 1000 });
      s.addOverlay(this.snow);
    }
    if (!snow && this.snow) {
      this.snow.destroy();
      this.snow = undefined;
    }
    if (this.snow)
      this.snow.setConfig({
        frame: ['snow-0', 'snow-1', 'snow-1', 'snow-2', 'snow-3'],
        speedY: { min: 24, max: 46 },
        speedX: { min: -14, max: 14 },
        lifespan: ((h + 60) / 35) * 1000,
        frequency: [0, 120, 50, 18][snow],
        quantity: 1 + Math.floor(w / 500),
        emitZone: zone(40),
      });
  }
}
