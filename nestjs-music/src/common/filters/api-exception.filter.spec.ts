import { ArgumentsHost } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter.js';

describe('ApiExceptionFilter', () => {
  function createHost() {
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/' }),
      }),
    } as unknown as ArgumentsHost;

    return { host, response };
  }

  it('normaliza una HttpException a { code, message }', () => {
    const { host, response } = createHost();
    const filter = new ApiExceptionFilter();

    filter.catch(new HttpException('Recurso no encontrado.', HttpStatus.NOT_FOUND), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      code: 404,
      message: 'Recurso no encontrado.',
    });
  });

  it('incluye errors en errores de validación', () => {
    const { host, response } = createHost();
    const filter = new ApiExceptionFilter();

    const exception = new HttpException(
      {
        message: 'Los datos enviados no son válidos.',
        errors: [{ field: 'Name', message: 'Name es obligatorio.' }],
      },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      code: 400,
      message: 'Los datos enviados no son válidos.',
      errors: [{ field: 'Name', message: 'Name es obligatorio.' }],
    });
  });

  it('oculta los detalles en errores 500', () => {
    const { host, response } = createHost();
    const filter = new ApiExceptionFilter();

    filter.catch(new Error('detalle interno'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      code: 500,
      message: 'Error interno del servidor.',
    });
  });

  it('no agrega cuerpo en respuestas 204', () => {
    const { host, response } = createHost();
    const filter = new ApiExceptionFilter();

    filter.catch(new HttpException('', HttpStatus.NO_CONTENT), host);

    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.send).toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('convierte JSON malformado en 400', () => {
    const { host, response } = createHost();
    const filter = new ApiExceptionFilter();

    const syntaxError = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      type: 'entity.parse.failed',
    });

    filter.catch(syntaxError, host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 400 }),
    );
  });
});