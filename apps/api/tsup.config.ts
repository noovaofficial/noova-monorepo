import { defineConfig } from 'tsup';

export default defineConfig({
  // Второй вход — процесс фоновых задач: он живёт в своём контейнере,
  // но делит код с API (Prisma, конфигурация, функции чистки).
  entry: ['src/server.ts', 'src/jobs/runner.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Воркспейс-пакеты инлайнятся в бандл, всё остальное остаётся в node_modules.
  noExternal: ['@noova/shared'],
  splitting: false,
});
