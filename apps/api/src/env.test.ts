import { describe, expect, it } from 'vitest';
import { missingProductionSecrets } from './env.js';

const NAMES = ['IP_HASH_SALT', 'INTERNAL_API_TOKEN', 'S3_SECRET_KEY'] as const;

describe('секреты прода', () => {
  it('вне прода ничего не требует', () => {
    expect(missingProductionSecrets({ NODE_ENV: 'development' }, NAMES)).toEqual([]);
  });

  it('называет пустые и оставленные дев-значениями', () => {
    expect(
      missingProductionSecrets(
        {
          NODE_ENV: 'production',
          IP_HASH_SALT: 'dev-only-salt',
          INTERNAL_API_TOKEN: '',
          S3_SECRET_KEY: 'настоящий',
        },
        NAMES,
      ),
    ).toEqual(['IP_HASH_SALT', 'INTERNAL_API_TOKEN']);
  });

  it('пропускает, когда всё задано', () => {
    expect(
      missingProductionSecrets(
        { NODE_ENV: 'production', IP_HASH_SALT: 'a', INTERNAL_API_TOKEN: 'b', S3_SECRET_KEY: 'c' },
        NAMES,
      ),
    ).toEqual([]);
  });
});
