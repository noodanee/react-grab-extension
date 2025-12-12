import { defineConfig } from 'vite';
import path from 'node:path';

const target = process.env.TARGET === 'inject' ? 'inject' : 'content';
const entry = target === 'inject' ? 'src/inject.ts' : 'src/content.ts';
const fileName = target === 'inject' ? 'inject.js' : 'content.js';
const emptyOutDir = target === 'content';

export default defineConfig({
  publicDir: 'public',
  build: {
    target: 'es2019',
    sourcemap: false,
    assetsDir: '',
    outDir: 'dist',
    emptyOutDir,
    lib: {
      entry: path.resolve(__dirname, entry),
      formats: ['iife'],
      name: 'ReactGrab',
      fileName: () => fileName
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  },
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});
