// 角色精灵表 assets/avatar.png，布局见 shared/social.ts 的 AVATAR。
// 可染色部件（皮肤、下装、上衣、头发）用灰阶画，运行时乘以玩家选的颜色；细节层（眼睛、鞋）不染色。
import { AVATAR, HAIR_STYLE } from '../shared/social.ts';
import type { PalKey } from './palette.ts';
import { Pix } from './pix.ts';

const { w: FRAME_W, h: FRAME_H, frames: FRAMES, rows: AVATAR_ROWS } = AVATAR;
const DIRS = 4; // 下、左、右、上，与 shared/social.ts 的 DIR 一致

type Layer = 'skin' | 'bottom' | 'top' | 'detail' | 'hair';
const T1: PalKey = 'tint1', T2: PalKey = 'tint2', T3: PalKey = 'tint3';

/** 迈步时左右腿、左右手的上下偏移（站立帧全 0） */
const STEP = [
  { legL: 0, legR: 0, armL: 0, armR: 0, bob: 0 },
  { legL: 1, legR: -1, armL: -1, armR: 1, bob: -1 },
  { legL: -1, legR: 1, armL: 1, armR: -1, bob: -1 },
];

function drawLayer(layer: Layer, dir: number, frame: number, hair = 0): Pix {
  const p = new Pix(FRAME_W, FRAME_H);
  const s = STEP[frame];
  const b = s.bob; // 整个上半身随步伐上下
  const side = dir === 1 || dir === 2;
  const flip = dir === 2;
  const X = (x: number) => (flip ? FRAME_W - 1 - x : x);
  const px = (x: number, y: number, c: PalKey) => p.px(X(x), y, c);
  const rect = (x: number, y: number, w: number, h: number, c: PalKey) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c);
  };

  if (layer === 'skin') {
    // 头：8×9 的圆角方块
    rect(4, 3 + b, 8, 9, T2);
    px(4, 3 + b, 'ink'), px(11, 3 + b, 'ink');
    rect(5, 10 + b, 6, 1, T1); // 下巴阴影
    if (!side) {
      rect(3, 15 + b + s.armL, 1, 2, T2); // 左手
      rect(12, 15 + b + s.armR, 1, 2, T2); // 右手
    } else {
      rect(7 + (frame === 1 ? -2 : frame === 2 ? 2 : 0), 15 + b, 2, 2, T2);
    }
    p.outline('ink');
  }

  if (layer === 'bottom') {
    if (!side) {
      rect(5, 18, 3, 4 + s.legL, T2);
      rect(8, 18, 3, 4 + s.legR, T2);
      rect(7, 18, 1, 3, T1);
    } else {
      const spread = frame === 0 ? 0 : 2;
      rect(6 - spread / 2, 18, 3, 4, T1);
      rect(7 + spread / 2, 18, 3, 4, T2);
    }
    p.outline('ink');
  }

  if (layer === 'top') {
    rect(4, 12 + b, 8, 6, T2);
    rect(4, 12 + b, 1, 6, T3); // 左侧受光
    rect(11, 12 + b, 1, 6, T1); // 右侧背光
    rect(4, 17 + b, 8, 1, T1); // 下摆
    if (!side) {
      rect(3, 12 + b, 1, 3 + s.armL, T1); // 袖子
      rect(12, 12 + b, 1, 3 + s.armR, T1);
    } else {
      rect(7 + (frame === 1 ? -2 : frame === 2 ? 2 : 0), 12 + b, 2, 3, T1);
    }
    if (dir === 0) rect(7, 12 + b, 2, 1, T1); // 领口
    p.outline('ink');
  }

  if (layer === 'detail') {
    // 鞋
    if (!side) {
      rect(5, 22 + s.legL, 3, 1, 'slate');
      rect(8, 22 + s.legR, 3, 1, 'slate');
    } else {
      const spread = frame === 0 ? 0 : 2;
      rect(5 - spread / 2, 22, 3, 1, 'slate');
      rect(7 + spread / 2, 22, 4, 1, 'slate');
    }
    // 眼睛
    if (dir === 0) px(6, 8 + b, 'ink'), px(9, 8 + b, 'ink');
    if (side) px(5, 8 + b, 'ink');
  }

  if (layer === 'hair') drawHair(rect, px, hair, dir, b);
  if (layer === 'hair') p.outline('ink');
  return p;
}

type Rect = (x: number, y: number, w: number, h: number, c: PalKey) => void;
type Px = (x: number, y: number, c: PalKey) => void;

function drawHair(rect: Rect, px: Px, style: number, dir: number, b: number): void {
  const back = dir === 3, side = dir === 1 || dir === 2;
  // 头顶一块：所有发型共有（寸头只有薄薄一层）
  if (style === 4) {
    rect(4, 2 + b, 8, 2, T1);
    if (back) rect(4, 4 + b, 8, 3, T1);
    return;
  }
  rect(4, 1 + b, 8, 4, T2);
  rect(5, 1 + b, 6, 1, T3);
  if (back) {
    rect(4, 5 + b, 8, 5, T2);
    rect(4, 9 + b, 8, 1, T1);
  } else if (side) {
    rect(7, 5 + b, 5, 4, T2); // 后脑
    rect(4, 5 + b, 2, 1, T2); // 刘海
  } else {
    rect(4, 5 + b, 1, 3, T2);
    rect(11, 5 + b, 1, 3, T2);
    rect(5, 5 + b, 2, 1, T2);
  }
  if (style === 1 && !back) {
    // 中分：额头中间露缝，两侧更长
    if (!side) px(7, 2 + b, 'tint1'), px(8, 2 + b, 'tint1');
    rect(side ? 10 : 4, 8 + b, 1, 2, T2);
    if (!side) rect(11, 8 + b, 1, 2, T2);
  }
  if (style === 2) {
    // 马尾：脑后一束
    if (back) rect(7, 10 + b, 2, 4, T1);
    else if (side) rect(12, 5 + b, 2, 6, T1);
    else rect(12, 4 + b, 1, 4, T1);
  }
  if (style === 3) {
    // 长发：披到肩下
    if (back) rect(4, 10 + b, 8, 4, T1);
    else if (side) rect(8, 9 + b, 4, 5, T1);
    else rect(3, 6 + b, 2, 8, T1), rect(11, 6 + b, 2, 8, T1);
  }
}

export function drawAvatarSheet(): Pix {
  const rows = AVATAR_ROWS.hair + HAIR_STYLE.length * DIRS;
  const sheet = new Pix(FRAME_W * FRAMES, FRAME_H * rows);
  const put = (row: number, layer: Layer, dir: number, hair = 0) => {
    for (let f = 0; f < FRAMES; f++) sheet.blit(drawLayer(layer, dir, f, hair), f * FRAME_W, row * FRAME_H);
  };
  for (let d = 0; d < DIRS; d++) {
    put(AVATAR_ROWS.skin + d, 'skin', d);
    put(AVATAR_ROWS.bottom + d, 'bottom', d);
    put(AVATAR_ROWS.top + d, 'top', d);
    put(AVATAR_ROWS.detail + d, 'detail', d);
    for (let h = 0; h < HAIR_STYLE.length; h++) put(AVATAR_ROWS.hair + h * DIRS + d, 'hair', d, h);
  }
  return sheet;
}
