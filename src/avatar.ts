// 一个角色：分层精灵（皮肤、下装、上衣、细节、头发）叠在一个容器里，按脚底 y 排深度。
// 自己的角色多一层半透明“幽灵”画在最上面：被楼或树挡住时仍能看到轮廓；没被挡时与本体重合，看不出来。
import Phaser from 'phaser';
import { AVATAR, AVATAR_PARTS, avatarFrame, tintOf, type Look } from '../shared/social.ts';

/** 三帧走路：左脚、站立、右脚、站立 */
const WALK_CYCLE = [0, 1, 2, 1];
const WALK_FPS = 7;
/** 幽灵层的深度：高于一切世界物体 */
export const GHOST_DEPTH = 1e6;

/** 世界坐标、世界朝向 → 当前视角下的显示位置和朝向；场景切换视角时替换 */
export const display = {
  at: (x: number, y: number) => ({ x, y }),
  dir: (d: number) => d,
};

export class Avatar {
  /** 世界坐标（脚底） */
  x: number;
  y: number;
  /** 世界朝向 */
  dir = 3;
  moving = false;
  private look: Look;
  /** 昼夜色调，乘在部件颜色上 */
  private shade = 0xffffff;
  private readonly body: Phaser.GameObjects.Container;
  private readonly ghost?: Phaser.GameObjects.Container;
  private animT = 0;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, look: Look, x: number, y: number, self = false) {
    this.look = look;
    this.x = x;
    this.y = y;
    const make = () => {
      const c = scene.add.container(x, y);
      c.add(scene.add.image(0, 0, 'foot-shadow').setOrigin(0.5, 0.5));
      for (let i = 0; i < AVATAR_PARTS.length; i++) c.add(scene.add.sprite(0, 0, 'avatar', 0).setOrigin(0.5, AVATAR.footY / AVATAR.h).setScale(AVATAR.scale));
      layer.add(c);
      return c;
    };
    this.body = make();
    if (self) this.ghost = make().setAlpha(0.35).setDepth(GHOST_DEPTH);
    this.setLook(look);
    this.place(x, y);
  }

  setLook(look: Look): void {
    this.look = look;
    for (const c of this.containers())
      AVATAR_PARTS.forEach((p, i) => {
        const s = c.list[i + 1] as Phaser.GameObjects.Sprite;
        s.setTint(mulColor(p.tint ? tintOf(look, p.tint) : 0xffffff, this.shade));
      });
    this.applyFrame();
  }

  place(x: number, y: number): void {
    this.x = x;
    this.y = y;
    const s = display.at(x, y);
    this.body.setPosition(s.x, s.y).setDepth(s.y);
    this.ghost?.setPosition(s.x, s.y);
  }

  /** 视角变了：重新摆位置、换朝向帧 */
  redraw(): void {
    this.place(this.x, this.y);
    this.applyFrame();
  }

  update(dt: number): void {
    this.animT = this.moving ? this.animT + dt : 0;
    this.applyFrame();
  }

  /** 昼夜色调 */
  setShade(c: number): void {
    if (c === this.shade) return;
    this.shade = c;
    this.setLook(this.look);
  }

  /** 访客自己半透明 */
  setAlpha(a: number): void {
    this.body.setAlpha(a);
  }

  destroy(): void {
    for (const c of this.containers()) c.destroy();
  }

  private containers(): Phaser.GameObjects.Container[] {
    return this.ghost ? [this.body, this.ghost] : [this.body];
  }

  private applyFrame(): void {
    const col = this.moving ? WALK_CYCLE[Math.floor(this.animT * WALK_FPS) % WALK_CYCLE.length] : AVATAR.idle;
    for (const c of this.containers())
      AVATAR_PARTS.forEach((p, i) => (c.list[i + 1] as Phaser.GameObjects.Sprite).setFrame(avatarFrame(p.block(this.look), display.dir(this.dir), col)));
  }
}

/** 两个颜色逐通道相乘 */
export function mulColor(a: number, b: number): number {
  const ch = (s: number) => Math.round((((a >> s) & 255) * ((b >> s) & 255)) / 255) << s;
  return ch(16) | ch(8) | ch(0);
}
