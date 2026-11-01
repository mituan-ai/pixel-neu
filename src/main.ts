// 入口：加载像素字体和地图 → 启动场景（先作为进入面板的背景）→ 玩家确认后连上房间。
import Phaser from 'phaser';
import type { TiledMap } from '../shared/world.ts';
import { Net } from './net.ts';
import { CampusScene } from './scene.ts';
import './style.css';
import { showHud, showJoin, type Hud } from './ui.ts';

const ui = document.getElementById('ui')!;

async function boot(): Promise<void> {
  const font = new FontFace('Fusion Pixel', 'url(fonts/fusion-pixel-12.woff2)');
  const [map] = await Promise.all([
    fetch('map.json').then((r) => r.json() as Promise<TiledMap>),
    font.load().then((f) => document.fonts.add(f)).catch(() => undefined),
  ]);

  let hud: Hud | null = null;
  let roomId = '';
  const scene = new CampusScene(map, {
    poi: (p) => hud?.setPoi(p),
    count: (n) => hud?.setCount(n, roomId),
    left: (code) => hud?.toast(code === 1000 ? '已离开校园' : '与服务器的连接断开了，刷新页面重新进入'),
  });

  // 开发时在控制台用 pixelNeu.scene 调试（线上构建里不存在）
  if (import.meta.env.DEV) Object.assign(window, { pixelNeu: { scene } });

  new Phaser.Game({
    type: Phaser.WEBGL,
    parent: 'game',
    backgroundColor: '#2a2433',
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene,
  });

  await showJoin(ui, async (name, look) => {
    const net = await Net.join(name, look, scene.handlers);
    roomId = net.roomId;
    scene.attach(net);
    hud = showHud(
      ui,
      { emote: (i) => net.emote(i), say: (i) => net.say(i), rotate: (step) => scene.rotate(step), zoom: (step) => scene.zoomBy(step), walkTo: (x, y) => scene.walkTo(x, y) },
      { size: scene.mapSize, zoom: scene.zoom, landmarks: scene.landmarks, dots: () => scene.dots(), destination: () => scene.destination() },
    );
    scene.onView = (v) => hud?.setView(v);
    scene.onZoom = (z) => hud?.setZoom(z);
    hud.setCount(Math.max(1, scene.dots().length), roomId);
  });
}

boot().catch((e) => {
  console.error(e);
  ui.textContent = '加载失败，请刷新页面。';
});
