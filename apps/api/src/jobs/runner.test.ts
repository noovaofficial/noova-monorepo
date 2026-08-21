import { describe, expect, it, vi } from 'vitest';
import { runAllJobs } from './runner.js';
import { JOBS } from './tasks.js';

describe('runAllJobs', () => {
  it('падение одной задачи не отменяет остальные', async () => {
    // Чистка фотографий зависит от хранилища, чистка журналов — только от БД.
    // Недоступный MinIO не должен означать, что журналы копятся дальше.
    const failing = JOBS[0]!;
    const spy = vi.spyOn(failing, 'run').mockRejectedValue(new Error('хранилище недоступно'));

    try {
      // biome-ignore lint/suspicious/noExplicitAny: задачи замоканы, клиент не используется
      const results = await runAllJobs({} as any);

      expect(results).toHaveLength(JOBS.length);
      expect(results[0]).toEqual({ name: failing.name, error: 'хранилище недоступно' });
      // Остальные дошли до выполнения, а не были пропущены.
      expect(results.slice(1).every((r) => 'removed' in r || 'error' in r)).toBe(true);
      expect(results.slice(1).some((r) => 'error' in r && r.error === 'хранилище недоступно')).toBe(
        false,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('в списке нет чистки документов верификации', () => {
    // Приёма документов ещё нет (N-07 отложена). Задача, удаляющая то, чего
    // не существует, создаёт ложное чувство исполненного обязательства.
    expect(JOBS.map((job) => job.name)).not.toContain('verification-documents');
  });
});
