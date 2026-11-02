// 入口：加载页 → 字体、地图、图标 → 启动场景 → 读登录状态 → 进房间（没登录就以访客身份旁观）→ 界面。
// 登录、退出时重连房间：服务端按令牌决定是玩家还是访客。
import Phaser from 'phaser';
import { FALLBACK_WEATHER } from '../shared/weather.ts';
import type { TiledMap } from '../shared/world.ts';
import { account } from './account.ts';
import { Net } from './net.ts';
import { CampusScene } from './scene.ts';
import { settings } from './settings.ts';
import { Sky } from './sky.ts';
import './style.css';
import { ChatPanel } from './ui/chat.ts';
import { loadIcons, toast } from './ui/dom.ts';
import { Hud } from './ui/hud.ts';
import { loginSheet, profileSheet } from './ui/login.ts';
import { Menu } from './ui/menu.ts';
import { PRIVACY, TERMS } from './legal.ts';

const loading = {
  bar: document.getElementById('loading-bar')!,
  text: document.getElementById('loading-text')!,
  set(p: number, text?: string) {
    this.bar.style.width = `${Math.round(4 + p * 96)}%`;
    if (text) this.text.textContent = text;
  },
  done() {
    const l = document.getElementById('loading')!;
    l.classList.add('done');
    setTimeout(() => l.remove(), 500);
  },
};

async function boot(): Promise<void> {
  const font = new FontFace('Fusion Pixel', 'url(fonts/fusion-pixel-12.woff2)');
  const [map] = await Promise.all([
    fetch('map.json').then((r) => r.json() as Promise<TiledMap>),
    font.load().then((f) => document.fonts.add(f)).catch(() => undefined),
    loadIcons(),
    account.restore(),
  ]);
  loading.set(0.4, '正在搭建校园…');

  let hud: Hud | null = null;
  let net: Net | null = null;
  const scene = new CampusScene(map, {
    poi: (p) => hud?.setPoi(p),
    count: (n) => hud?.setCount(n),
    ride: (s) => hud?.setRide(s),
  });
  scene.guestLook = account.guestLook();
  // 开发时在控制台用 pixelNeu.scene 调试（线上构建里不存在）
  if (import.meta.env.DEV) Object.assign(window, { pixelNeu: { scene, account } });

  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: 'game',
    backgroundColor: '#8fd18b',
    pixelArt: true,
    roundPixels: true,
    preserveDrawingBuffer: true,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene,
  });
  await scene.created;
  const sky = new Sky(scene);

  const chat = new ChatPanel({
    send: (ch, text) => net?.chat(ch, text),
    history: (ch) => net?.history(ch),
    report: (id) => net?.report(id),
    block: (uid, on) => net?.block(uid, on),
    sid: () => net?.sessionId ?? '',
    login: () => openLogin(),
  });

  const openLogin = () =>
    loginSheet({
      done: async (created) => {
        await reconnect();
        if (created || account.me?.name === '东大人') profileSheet(true, () => net?.profileChanged()).show();
        else toast(`欢迎回来，${account.me?.name}`);
      },
      legal: (w) => menu.doc(w === 'terms' ? '用户协议' : '隐私政策', w === 'terms' ? TERMS : PRIVACY),
    }).show();

  const menu = new Menu({
    login: openLogin,
    profile: () => profileSheet(false, () => net?.profileChanged()).show(),
    logout: async () => {
      await account.logout();
      await reconnect();
      toast('已退出登录');
    },
    poster: () => poster(game, hud?.currentPoi?.name ?? '东北大学 · 南湖校区'),
  });

  let retry = 0;
  const connect = async () => {
    net = await Net.join(account.token, {
      ...scene.handlers,
      chat: (l) => {
        chat.receive(l);
        if (l.ch === 'near' && l.sid) scene.showChat(l.sid, l.text);
      },
      history: (ch, lines) => chat.history(ch, lines),
      notice: (t) => chat.system(t),
      weather: (w) => {
        hud?.sky.setWeather(w);
        sky.setWeather(w);
      },
      hello: (h) => {
        scene.handlers.hello(h);
        hud?.sky.setWeather(h.weather);
        sky.setWeather(h.weather);
        if (account.me && !h.visible) toast('这个平行校园人满了，你暂时是旁观者');
      },
      left: (code) => {
        if (code === 1000) return;
        // 断线自动重连：间隔逐渐拉长
        toast('与服务器的连接断开了，正在重连…', 5000);
        scene.detach();
        setTimeout(() => void connect().catch(() => undefined), Math.min(30_000, 1000 * 2 ** retry++));
      },
    });
    retry = 0;
    scene.attach(net);
    chat.reset();
    hud?.refreshAccount();
  };
  const reconnect = async () => {
    net?.leave();
    scene.detach();
    await connect();
  };

  loading.set(0.6, '正在进入校园…');
  try {
    await connect();
  } catch (e) {
    console.error(e);
    toast('连不上服务器，先离线逛逛；刷新页面可以重试', 6000);
    scene.handlers.hello({ ...scene.spawnPoint, visible: false, weather: FALLBACK_WEATHER });
  }
  await Promise.race([scene.ready, new Promise((r) => setTimeout(r, 8000))]);
  loading.set(1);

  hud = new Hud(
    {
      emote: (i) => net?.emote(i),
      say: (i) => net?.say(i),
      rotate: (step) => scene.rotate(step),
      zoom: (step) => scene.zoomBy(step),
      walkTo: (x, y) => scene.walkTo(x, y),
      stick: (x, y) => scene.setStick(x, y),
      ride: () => {
        if (!scene.toggleRide()) {
          toast('登录后可以骑车');
          openLogin();
        }
      },
      login: openLogin,
    },
    { size: scene.mapSize, zoom: scene.zoom, landmarks: scene.landmarks, dots: () => scene.dots(), destination: () => scene.destination() },
    chat,
    menu,
  );
  document.getElementById('ui')!.append(hud.el);
  scene.onView = (v) => hud?.setView(v);
  scene.onZoom = (z) => hud?.setZoom(z);
  hud.setCount(Math.max(1, scene.dots().length));
  sky.apply(settings.value);
  settings.subscribe((s) => sky.apply(s));
  loading.done();
}

/** 分享海报：当前画面截图，加上地名、标题和网址 */
async function poster(game: Phaser.Game, place: string): Promise<string> {
  const shot = await new Promise<HTMLImageElement>((res) => game.renderer.snapshot((img) => res(img as HTMLImageElement)));
  const W = 540, H = 720;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#fffaf0';
  g.fillRect(0, 0, W, H);
  // 截图按中心裁成方形
  const s = Math.min(shot.width, shot.height);
  g.drawImage(shot, (shot.width - s) / 2, (shot.height - s) / 2, s, s, 20, 20, W - 40, W - 40);
  g.strokeStyle = '#2a2433';
  g.lineWidth = 4;
  g.strokeRect(20, 20, W - 40, W - 40);
  g.fillStyle = '#2a2433';
  g.font = `28px "Fusion Pixel", sans-serif`;
  g.fillText('像素东大 · Pixel NEU', 24, W + 30);
  g.fillStyle = '#1f7fc4';
  g.font = `20px "Fusion Pixel", sans-serif`;
  g.fillText(`我在 ${place}`, 24, W + 66);
  g.fillStyle = '#8a7f6c';
  g.font = `14px "Fusion Pixel", sans-serif`;
  g.fillText(location.host + location.pathname, 24, W + 100);
  g.fillText('非官方作品 · © OpenStreetMap 贡献者', 24, W + 124);
  g.fillStyle = '#ffb627';
  g.fillRect(W - 120, W + 14, 96, 30);
  g.fillStyle = '#2a2433';
  g.font = `16px "Fusion Pixel", sans-serif`;
  g.fillText('一起来逛', W - 104, W + 35);
  return c.toDataURL('image/png');
}

boot().catch((e) => {
  console.error(e);
  const t = document.getElementById('loading-text');
  if (t) t.textContent = '加载失败，请刷新页面。';
});
