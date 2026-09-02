import { defineConfig } from 'tsup';

export default defineConfig({
  // Второй вход — процесс фоновых задач: он живёт в своём контейнере,
  // но делит код с API (Prisma, конфигурация, функции чистки).
  // Третий вход — разовое создание первого администратора на сервере.
  // В прод-образе нет dev-зависимостей, а значит и tsx: без сборки в dist
  // запустить prisma/create-admin.ts там нечем.
  entry: [
    'src/server.ts',
    'src/jobs/runner.ts',
    'src/scripts/create-admin.ts',
    'src/scripts/seed-reference.ts',
    'src/scripts/export-reference.ts',
    'src/scripts/grant-launch-listings.ts',
  ],
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
