import { rmSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  base: './',
  // assets/ 里是游戏直接加载的成品素材，原样拷到 dist 根目录
  publicDir: 'assets',
  define: { __VERSION__: JSON.stringify(pkg.version) },
  // Phaser 本身就有约 1.5 MB（gzip 后约 420 KB），整包加载即可，不拆分
  build: { chunkSizeWarningLimit: 1700 },
  server: {
    // 开发时 /colyseus 转给本机的联机服务器（npm run server，端口同样读 PORT），与线上 nginx 的配置一致
    proxy: {
      '/colyseus': { target: `http://127.0.0.1:${process.env.PORT ?? 2567}`, ws: true, rewrite: (p) => p.replace(/^\/colyseus/, '') },
    },
  },
  plugins: [
    {
      // 美术规范文档放在 assets/ 里方便查阅，但不发布出去
      name: 'strip-asset-docs',
      closeBundle() {
        rmSync('dist/AGENTS.md', { force: true });
      },
    },
  ],
  test: { include: ['tests/**/*.test.ts'] },
});
