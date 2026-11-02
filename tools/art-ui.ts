// 界面图标和九宫格面板皮肤（目录见 shared/icons.ts），锚点在左上角。
// 现在是占位色块，正式美术按 docs/codex/TASK-10-ui.md 画。
import { ICONS, ICON_SIZE, SKINS, SKIN_SIZE } from '../shared/icons.ts';
import { Pix, type Sprite } from './pix.ts';

export function drawUi(): Record<string, Sprite> {
  const out: Record<string, Sprite> = {};
  for (const name of ICONS) {
    const p = new Pix(ICON_SIZE, ICON_SIZE);
    p.rect(3, 3, ICON_SIZE - 6, ICON_SIZE - 6, 'water1');
    p.outline('ink');
    out[name] = { pix: p, ax: 0, ay: 0 };
  }
  for (const name of SKINS) {
    const p = new Pix(SKIN_SIZE, SKIN_SIZE);
    p.rect(1, 1, SKIN_SIZE - 2, SKIN_SIZE - 3, 'flowerW');
    p.outline('ink');
    out[name] = { pix: p, ax: 0, ay: 0 };
  }
  return out;
}
