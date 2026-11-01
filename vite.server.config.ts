// 联机服务器打包成单个文件（含 Colyseus），服务器上只需要 Node，不必 npm install。
// 地图文件用环境变量 MAP_FILE 指定（见 server/room.ts）。
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  ssr: { noExternal: true, external: ['bufferutil', 'utf-8-validate'] },
  build: {
    ssr: 'server/main.ts',
    outDir: 'dist-server',
    target: 'node22',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'server.mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' } },
  },
});
