import { BadRequestException } from '@nestjs/common';
import { validateIdempotencyKey } from './idempotency-key.js';

describe('validateIdempotencyKey', () => {
  it.each([
    ['missing', undefined],
    ['absent', []],
    ['empty', ['']],
    ['whitespace-only', [' \t']],
    ['repeated', ['same-key', 'same-key']],
  ])('rejects a %s header', (_case, values) => {
    expect(() => validateIdempotencyKey(values)).toThrow(BadRequestException);
  });

  it('returns the single non-empty header value unchanged', () => {
    expect(validateIdempotencyKey([' key-1 '])).toBe(' key-1 ');
  });
});
