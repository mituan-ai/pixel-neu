// 界面图标和九宫格面板皮肤（目录见 shared/icons.ts），锚点在左上角。
import { ICONS, ICON_SIZE, SKINS, SKIN_SIZE } from '../shared/icons.ts';
import type { IconName } from '../shared/icons.ts';
import type { PalKey } from './palette.ts';
import { Pix, type Sprite } from './pix.ts';

const ACTIONS: Record<string, string[]> = {
  chat: [
    '  ########  ', ' #++++++++# ', '#++++++++++#', '#++#++#++#+#', '#++++++++++#', '#++++++++++#',
    ' #++++++++# ', '  ##+++###  ', '    #+#     ', '    ##      ',
  ],
  send: [
    '          ##', '       ### #', '    ###+++ #', ' ###++++++# ', '#+++++++++# ', ' ##++++++#  ',
    '   #++#++#  ', '   #+# ++#  ', '   ##  +#   ', '   #   +#   ', '       #    ',
  ],
  emote: [
    '   ######   ', ' ##++++++## ', ' #++++++++# ', '#++#++++#++#', '#++#++++#++#', '#++++++++++#',
    '#++#++++#++#', ' #++####++# ', ' ##++++++## ', '   ######   ',
  ],
  menu: [
    ' ########## ', ' #++++++++# ', ' ########## ', '            ', ' ########## ', ' #++++++++# ',
    ' ########## ', '            ', ' ########## ', ' #++++++++# ', ' ########## ',
  ],
  close: [
    ' ##      ## ', ' #+#    #+# ', '  #+#  #+#  ', '   #+##+#   ', '    #++#    ', '    #++#    ',
    '   #+##+#   ', '  #+#  #+#  ', ' #+#    #+# ', ' ##      ## ',
  ],
  back: [
    '     ##     ', '    #+#     ', '   #+#      ', '  #+#       ', ' #+######## ', '#+++++++++# ',
    ' #+######## ', '  #+#       ', '   #+#      ', '    #+#     ', '     ##     ',
  ],
  map: [
    '    ##      ', ' ###++# ### ', '#+++++#++++#', '#++#++#++#+#', '#++#++#++#+#', '#++#++#++#+#',
    '#++#++#++#+#', '#++#++#++#+#', '#++#++#++#+#', '#+++++#++++#', ' ###++# ### ', '    ##      ',
  ],
  share: [
    '        ### ', '       #+++#', '       #+++#', '  ###   ### ', ' #+++# ##   ', ' #+++##     ',
    '  ###  ##   ', '       #+## ', '       #+++#', '        ### ',
  ],
  login: [
    '      ##### ', '      #+++# ', '  ##  #+  # ', '  #+# #+  # ', '###++##+  # ', '#+++++++# # ',
    '###++##+  # ', '  #+# #+  # ', '  ##  #+  # ', '      #+++# ', '      ##### ',
  ],
  logout: [
    ' #####      ', ' #+++#      ', ' #  +#  ##  ', ' #  +# #+#  ', ' #  +##++###', ' # #+++++++#',
    ' #  +##++###', ' #  +# #+#  ', ' #  +#  ##  ', ' #+++#      ', ' #####      ',
  ],
  group: [
    '    ####    ', '   #++++#   ', ' ## #++# ## ', '#++# ## #++#', '#++#    #++#', ' ## #### ## ',
    '   #++++#   ', ' ##++++++## ', '#++++++++++#', '#++#++++#++#', ' ## #### ## ',
  ],
  settings: [
    '    ####    ', ' ## #++# ## ', '#++##++##++#', '#++++++++++#', ' ##++##++## ', ' #++#  #++# ',
    ' #++#  #++# ', ' ##++##++## ', '#++++++++++#', '#++##++##++#', ' ## #++# ## ', '    ####    ',
  ],
  report: [
    '     ##     ', '    #++#    ', '    #++#    ', '   #+##+#   ', '   #+##+#   ', '  #++##++#  ',
    '  #++##++#  ', ' #++++++++# ', ' #+++##+++# ', '#++++##++++#', ' ########## ',
  ],
  block: [
    '   ######   ', ' ##++++++## ', ' #++++++### ', '#++++++##++#', '#+++++##+++#', '#++++##++++#',
    '#+++##+++++#', '#++##++++++#', ' ###++++++# ', ' ##++++++## ', '   ######   ',
  ],
  people: [
    '   ######   ', '  #++++++#  ', '  #++++++#  ', '   #++++#   ', '    ####    ', '            ',
    '   ######   ', ' ##++++++## ', '#++++++++++#', '#++++++++++#', ' ########## ',
  ],
  pin: [
    '   ######   ', '  #++++++#  ', ' #+++##+++# ', ' #++#  #++# ', ' #+++##+++# ', '  #++++++#  ',
    '   #++++#   ', '    #++#    ', '    #++#    ', '     ##     ',
  ],
  'rotate-left': [
    '  #         ', ' ##  #####  ', '#+# #+++++# ', '#++# ##### #', '#+++#     +#', '#####     +#',
    '          +#', ' #        +#', ' #+      +# ', '  #++++++#  ', '   ######   ',
  ],
  'zoom-in': [
    '   #####    ', '  #+++++#   ', ' #+++#+++#  ', ' #++###++#  ', ' #+++#+++#  ', ' #+++++++#  ',
    '  #+++++#   ', '   #####+#  ', '        #+# ', '         #+#', '          ##',
  ],
  'zoom-out': [
    '   #####    ', '  #+++++#   ', ' #+++++++#  ', ' #++###++#  ', ' #+++++++#  ', ' #+++++++#  ',
    '  #+++++#   ', '   #####+#  ', '        #+# ', '         #+#', '          ##',
  ],
  'sound-on': [
    '     ##     ', '    #+#  #  ', ' ###++#   # ', '#+++++# #  #', '#+++++#  # #', '#+++++#  # #',
    '#+++++# #  #', ' ###++#   # ', '    #+#  #  ', '     ##     ',
  ],
  'sound-off': [
    '     ##     ', '    #+#     ', ' ###++#     ', '#+++++# # # ', '#+++++#  #  ', '#+++++#  #  ',
    '#+++++# # # ', ' ###++#     ', '    #+#     ', '     ##     ',
  ],
  help: [
    '   ######   ', ' ##++++++## ', ' #++####++# ', '#++#++++#++#', '#++++++#+++#', '#++++##++++#',
    '#++++#+++++#', '#++++++++++#', ' #+++#++++# ', ' ##++++++## ', '   ######   ',
  ],
  // 铅笔：菜单「参与开发」
  pencil: [
    '        ##  ', '       #++# ', '      #++++#', '     ##++++#', '    #+##++# ', '   #++++##  ',
    '  #++++#    ', ' #++++#     ', ' #+++#      ', '#+###       ', '##          ',
  ],
};

/** 太阳的圆面和八向光芒。 */
function sun(p: Pix, cx: number, cy: number, small: boolean): void {
  const r = small ? 2 : 3;
  p.ellipse(cx, cy, r, r, 'uiOrange');
  p.outline('ink');
  p.px(cx - 1, cy - 1, 'flowerY');
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]])
    p.px(cx + dx * (small ? 4 : 6), cy + dy * (dx && dy ? (small ? 3 : 4) : (small ? 4 : 6)), 'ink');
}

/** 月牙与两颗星，不涂底色遮挡透明区域。 */
function crescent(p: Pix, cx: number, cy: number, small: boolean): void {
  const r = small ? 3 : 5;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
    if (x * x + y * y <= r * r + 1 && (x - 2) ** 2 + (y + 2) ** 2 > r * r)
      p.px(cx + x, cy + y, 'beige3');
  p.outline('ink');
  if (!small) {
    p.px(12, 3, 'uiOrange'); p.px(11, 2, 'ink'); p.px(13, 2, 'ink');
    p.px(12, 1, 'uiOrange'); p.px(12, 4, 'ink');
    p.px(13, 8, 'uiOrange'); p.px(12, 7, 'ink'); p.px(14, 7, 'ink');
  }
}

/** 一朵有台阶轮廓、左上受光的云。 */
function cloud(p: Pix, x: number, y: number, dark: boolean): void {
  p.rect(x + 2, y + 2, 8, 4, 'ink');
  p.rect(x + 1, y + 3, 10, 2, 'ink');
  p.rect(x + 4, y, 4, 6, 'ink');
  p.rect(x + 3, y + 1, 6, 4, 'ink');
  p.rect(x + 2, y + 3, 8, 2, dark ? 'grey1' : 'grey3');
  p.rect(x + 4, y + 2, 4, 2, dark ? 'grey1' : 'grey3');
  p.hline(x + 4, y + 1, 3, dark ? 'grey2' : 'white');
  p.px(x + 2, y + 3, dark ? 'grey2' : 'white');
}

/** 六臂雪花。 */
function snowflake(p: Pix, cx: number, cy: number, small: boolean): void {
  const r = small ? 1 : 4;
  p.hline(cx - r, cy, r * 2 + 1, 'ink'); p.vline(cx, cy - r, r * 2 + 1, 'ink');
  if (!small) for (const sign of [-1, 1]) {
    p.px(cx - 2, cy + sign * 2, 'ink'); p.px(cx + 2, cy + sign * 2, 'ink');
    p.px(cx - 1, cy + sign * 3, 'uiBlue'); p.px(cx + 1, cy + sign * 3, 'uiBlue');
    p.px(cx + sign * 3, cy - 1, 'uiBlue'); p.px(cx + sign * 3, cy + 1, 'uiBlue');
  }
  p.px(cx, cy, 'uiBlue');
}

/** 北半球月相，盈月亮右侧、亏月亮左侧。 */
function moonPhase(phase: number): Pix {
  const p = new Pix(ICON_SIZE, ICON_SIZE), lit: PalKey = 'beige3';
  const curve = [1, 0.707, 0, -0.707, -1, -0.707, 0, 0.707][phase];
  p.ellipse(7, 7, 5, 5, 'slate');
  for (let y = -5; y <= 5; y++) {
    const half = Math.floor(Math.sqrt(25 - y * y));
    for (let x = -half; x <= half; x++) {
      const boundary = curve * half;
      if ((phase <= 4 && x >= boundary) || (phase > 4 && x <= -boundary)) p.px(7 + x, 7 + y, lit);
    }
  }
  p.outline('ink');
  if (phase === 0) {
    p.ellipse(7, 7, 5, 5, 'slate');
    for (let y = -5; y <= 0; y++) for (let x = -5; x <= 0; x++)
      if (x * x + y * y <= 25 && ((x - 1) ** 2 + y * y > 25 || x * x + (y - 1) ** 2 > 25)) p.px(7 + x, 7 + y, 'beige2');
  }
  if (phase === 4) { p.px(5, 5, 'flowerW'); p.px(10, 8, 'beige2'); p.px(8, 10, 'beige2'); }
  return p;
}

/** 操作、天气和天空条小图。 */
function icon(name: IconName): Pix {
  if (name.startsWith('moon-') && name !== 'moon-disc') return moonPhase(Number(name.slice(5)));
  const p = new Pix(ICON_SIZE, ICON_SIZE);
  const action = name === 'rotate-right' ? ACTIONS['rotate-left'].map((row) => [...row.padEnd(12)].reverse().join('')) : ACTIONS[name];
  if (action) {
    const accent: PalKey = name === 'login' ? 'uiGreen' : ['logout', 'report', 'block'].includes(name) ? 'uiOrange' : 'uiBlue';
    action.forEach((row, y) => [...row].forEach((c, x) => {
      if (c !== ' ') p.px(x + 2, y + 2, c === '#' ? 'ink' : accent);
    }));
  } else if (name === 'sun-disc' || name === 'moon-disc') {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const r2 = (x - 3.5) ** 2 + (y - 3.5) ** 2;
      if (r2 <= 16) p.px(x + 4, y + 4, r2 > 9 ? 'ink' : name === 'sun-disc' ? 'uiOrange' : 'beige3');
    }
    p.px(6, 5, name === 'sun-disc' ? 'flowerY' : 'flowerW');
  } else if (name === 'sunny') sun(p, 7, 7, false);
  else if (name === 'clear-night') crescent(p, 7, 8, false);
  else if (name === 'cloudy' || name === 'cloudy-night') {
    if (name === 'cloudy') sun(p, 6, 5, true); else crescent(p, 6, 5, true);
    cloud(p, 3, 7, false);
  } else if (name === 'overcast') {
    cloud(p, 0, 3, true); cloud(p, 3, 7, true);
  } else if (name === 'snow') snowflake(p, 7, 7, false);
  else if (name === 'fog' || name === 'haze') {
    if (name === 'haze') {
      p.ellipse(8, 5, 3, 3, 'ink'); p.ellipse(8, 5, 2, 2, 'gold');
    }
    for (let k = 0; k < 3; k++) {
      p.hline(k % 2 ? 3 : 2, 7 + k * 3, k % 2 ? 10 : 12, 'ink');
      p.hline(k % 2 ? 4 : 3, 6 + k * 3, k % 2 ? 8 : 10, name === 'haze' ? 'gold' : 'grey2');
    }
  } else {
    cloud(p, 1, 2, name !== 'rain-light');
    if (name === 'thunder') {
      p.hline(7, 8, 4, 'ink'); p.hline(6, 9, 4, 'ink'); p.hline(5, 10, 6, 'ink');
      p.hline(6, 11, 4, 'ink'); p.hline(6, 12, 3, 'ink'); p.px(6, 13, 'ink');
      p.px(8, 9, 'uiOrange'); p.hline(7, 10, 3, 'uiOrange'); p.px(7, 11, 'uiOrange');
    } else {
      const drops = name === 'rain-heavy' ? [3, 6, 9, 12] : name === 'sleet' ? [4] : [5, 10];
      for (const x of drops) { p.vline(x, 10, 3, 'ink'); p.vline(x, 10, 2, 'uiBlue'); p.px(x - 1, 13, 'ink'); }
      if (name === 'sleet') snowflake(p, 10, 11, true);
    }
  }
  return p;
}

/** 角块固定为 8 px，边带和中心保持纯色以便九宫格拉伸。 */
function skin(name: typeof SKINS[number]): Pix {
  const p = new Pix(SKIN_SIZE, SKIN_SIZE);
  const bubble = name === 'bubble', down = name === 'button-down', tab = name === 'tab' || name === 'tab-on';
  const fill: PalKey = name === 'button-primary' ? 'uiBlue' : name === 'panel' || name === 'tab-on' ? 'uiCream' : bubble ? 'white' : 'grey3';
  const top = down ? 2 : 0, bottom = bubble || down || tab ? 23 : 21;
  const edge = bubble ? 1 : 2;
  for (let y = top; y <= bottom; y++) for (let x = 0; x < SKIN_SIZE; x++) {
    const corner = Math.min(y - top, tab ? 4 : bottom - y);
    const cut = corner < edge ? 3 : corner < edge * 2 ? 1 : 0;
    if (x >= cut && x < SKIN_SIZE - cut) p.px(x, y, 'ink');
    const innerCorner = Math.min(y - top - edge, tab ? 4 : bottom - edge - y);
    const innerCut = innerCorner < 1 ? edge + 2 : innerCorner < 2 ? edge + 1 : edge;
    if (y >= top + edge && y <= bottom - (name === 'tab-on' ? 0 : edge) && x >= innerCut && x < SKIN_SIZE - innerCut)
      p.px(x, y, fill);
  }
  if (!bubble && !down && !tab) { p.hline(3, 22, 18, 'ink'); p.hline(4, 23, 16, 'ink'); }
  if (name === 'button-primary') p.hline(4, 2, 16, 'white');
  return p;
}

export function drawUi(): Record<string, Sprite> {
  const out: Record<string, Sprite> = {};
  for (const name of ICONS) out[name] = { pix: icon(name), ax: 0, ay: 0 };
  for (const name of SKINS) out[name] = { pix: skin(name), ax: 0, ay: 0 };
  return out;
}
