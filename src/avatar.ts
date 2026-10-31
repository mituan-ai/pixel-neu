// 一个角色：分层精灵（皮肤、下装、上衣、细节、头发）叠在一个容器里，按脚底 y 排深度。
// 自己的角色多一层半透明“幽灵”画在最上面：被楼或树挡住时仍能看到轮廓；没被挡时与本体重合，看不出来。
import Phaser from 'phaser';
import { AVATAR, BOTTOM_COLOR, HAIR_COLOR, SKIN, TOP_COLOR, type Look } from '../shared/social.ts';

const WALK_CYCLE = [0, 1, 0, 2];
const WALK_FPS = 8;
/** 幽灵层的深度：高于一切世界物体 */
export const GHOST_DEPTH = 1e6;

type Part = { row: (look: Look, dir: number) => number; tint?: (look: Look) => number };
const PARTS: Part[] = [
  { row: (_l, d) => AVATAR.rows.skin + d, tint: (l) => SKIN[l.skin] },
  { row: (_l, d) => AVATAR.rows.bottom + d, tint: (l) => BOTTOM_COLOR[l.bottom] },
  { row: (_l, d) => AVATAR.rows.top + d, tint: (l) => TOP_COLOR[l.top] },
  { row: (_l, d) => AVATAR.rows.detail + d },
  { row: (l, d) => AVATAR.rows.hair + l.hair * 4 + d, tint: (l) => HAIR_COLOR[l.hairColor] },
];

export class Avatar {
  x: number;
  y: number;
  dir = 3;
  moving = false;
  private look: Look;
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
      for (let i = 0; i < PARTS.length; i++) c.add(scene.add.sprite(0, 0, 'avatar', 0).setOrigin(0.5, 1));
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
      PARTS.forEach((p, i) => {
        const s = c.list[i + 1] as Phaser.GameObjects.Sprite;
        if (p.tint) s.setTint(p.tint(look));
        else s.clearTint();
      });
    this.applyFrame();
  }

  place(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.body.setPosition(x, y).setDepth(y);
    this.ghost?.setPosition(x, y);
  }

  update(dt: number): void {
    this.animT = this.moving ? this.animT + dt : 0;
    this.applyFrame();
  }

  destroy(): void {
    for (const c of this.containers()) c.destroy();
  }

  private containers(): Phaser.GameObjects.Container[] {
    return this.ghost ? [this.body, this.ghost] : [this.body];
  }

  private applyFrame(): void {
    const col = this.moving ? WALK_CYCLE[Math.floor(this.animT * WALK_FPS) % WALK_CYCLE.length] : 0;
    for (const c of this.containers())
      PARTS.forEach((p, i) => (c.list[i + 1] as Phaser.GameObjects.Sprite).setFrame(p.row(this.look, this.dir) * AVATAR.frames + col));
  }
}
