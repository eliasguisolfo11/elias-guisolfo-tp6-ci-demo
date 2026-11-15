import { BadRequestException } from '@nestjs/common';
import { ParseIdPipe } from './parse-id.pipe.js';

function captureBadRequestResponse(callback: () => unknown): unknown {
  try {
    callback();
  } catch (error) {
    if (error instanceof BadRequestException) {
      return error.getResponse();
    }

    throw error;
  }

  throw new Error('Expected a BadRequestException.');
}

describe('ParseIdPipe', () => {
  const pipe = new ParseIdPipe();
  const message = 'El id debe ser un entero no negativo.';

  it.each(['0', '1', '275'])('accepts the non-negative integer "%s"', (value) => {
    expect(pipe.transform(value)).toBe(Number(value));
  });

  it.each(['texto', '1.5', '1e3', '-1'])(
    'rejects the invalid id "%s" with the default response shape',
    (value) => {
      const response = captureBadRequestResponse(() => pipe.transform(value));

      expect(response).toMatchObject({ message });
      expect(response).not.toHaveProperty('errors');
    },
  );

  it('parses a catalog id', () => {
    expect(pipe.transformCatalogId('275')).toBe(275);
  });

  it.each(['texto', '1.5', '1e3', '-1'])(
    'rejects the invalid catalog id "%s" with field errors',
    (value) => {
      expect(
        captureBadRequestResponse(() => pipe.transformCatalogId(value)),
      ).toEqual({
        message,
        errors: [{ field: 'id', message }],
      });
    },
  );
});
