import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListQueryDto } from './list-query.dto.js';

async function validationErrors(query: Record<string, unknown>) {
  return validate(plainToInstance(ListQueryDto, query));
}

describe('ListQueryDto', () => {
  it('uses skip=0 and limit=100 by default', async () => {
    const query = plainToInstance(ListQueryDto, {});

    expect(query.skip).toBe(0);
    expect(query.limit).toBe(100);
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('converts digit strings to numbers', async () => {
    const query = plainToInstance(ListQueryDto, { skip: '5', limit: '20' });

    expect(query.skip).toBe(5);
    expect(query.limit).toBe(20);
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('rejects a negative skip', async () => {
    await expect(validationErrors({ skip: '-1' })).resolves.not.toHaveLength(0);
  });

  it('rejects a zero limit', async () => {
    await expect(validationErrors({ limit: '0' })).resolves.not.toHaveLength(0);
  });

  it('rejects an empty skip instead of converting it to zero', async () => {
    const query = plainToInstance(ListQueryDto, { skip: '' });

    expect(query.skip).toBe('');
    await expect(validate(query)).resolves.not.toHaveLength(0);
  });
});
