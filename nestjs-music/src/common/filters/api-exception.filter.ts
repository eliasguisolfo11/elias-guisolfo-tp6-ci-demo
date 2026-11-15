import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

interface ValidationIssue {
  field: string;
  message: string;
}

interface ApiErrorBody {
  code: number;
  message: string;
  errors?: ValidationIssue[];
  remainingCapacity?: number;
}

interface NormalizedBodyParserError {
  status: number;
  message: string;
}

const MALFORMED_JSON_MESSAGE = 'El cuerpo de la solicitud no es un JSON válido.';
const INVALID_URI_MESSAGE =
  'La ruta solicitada contiene una codificación inválida.';
const BODY_TOO_LARGE_MESSAGE = 'El cuerpo de la solicitud excede el tamaño permitido.';
const UNSUPPORTED_BODY_ENCODING_MESSAGE =
  'La codificación del cuerpo de la solicitud no es compatible.';
const BODY_PROCESSING_MESSAGE = 'El cuerpo de la solicitud no pudo procesarse.';
const REQUEST_PROCESSING_MESSAGE = 'La solicitud no pudo ser procesada.';
const BODY_PARSER_CLIENT_ERROR_TYPES = new Set([
  'charset.unsupported',
  'encoding.unsupported',
  'entity.parse.failed',
  'entity.too.large',
  'entity.verify.failed',
  'parameters.too.many',
  'request.aborted',
  'request.size.invalid',
]);
const UNKNOWN_ROUTE_MESSAGE = 'La ruta solicitada no existe.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getValidationIssues(value: unknown): ValidationIssue[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const issues = value.filter((item): item is ValidationIssue => {
    if (!isRecord(item)) {
      return false;
    }

    return typeof item.field === 'string' && typeof item.message === 'string';
  });

  return issues.length > 0 ? issues : undefined;
}

function isMalformedJsonParserMessage(message: string): boolean {
  return /^(?:unexpected|expected|unterminated|bad (?:control character|escaped character|unicode escape)|no number after minus sign|leading zero|fractional part|exponent part)\b[\s\S]*\bjson\b/i.test(
    message,
  );
}

function getBodyParserError(
  value: unknown,
): NormalizedBodyParserError | undefined {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    !BODY_PARSER_CLIENT_ERROR_TYPES.has(value.type) ||
    typeof value.status !== 'number' ||
    !Number.isInteger(value.status) ||
    value.status < 400 ||
    value.status >= 500
  ) {
    return undefined;
  }

  if (value.type === 'entity.parse.failed' && value.status === 400) {
    return { status: 400, message: MALFORMED_JSON_MESSAGE };
  }

  if (value.status === HttpStatus.PAYLOAD_TOO_LARGE) {
    return { status: value.status, message: BODY_TOO_LARGE_MESSAGE };
  }

  if (value.status === HttpStatus.UNSUPPORTED_MEDIA_TYPE) {
    return { status: value.status, message: UNSUPPORTED_BODY_ENCODING_MESSAGE };
  }

  if (value.status === HttpStatus.BAD_REQUEST) {
    return { status: value.status, message: BODY_PROCESSING_MESSAGE };
  }

  return { status: value.status, message: REQUEST_PROCESSING_MESSAGE };
}

function isMalformedUriMessage(message: string): boolean {
  return /^Failed to decode param\b/i.test(message);
}
function isUnknownRouteMessage(message: string): boolean {
  return /^Cannot [A-Z]+ \//.test(message);
}

function normalizeErrorDetails(
  status: number,
  message: string,
  errors: ValidationIssue[] | undefined,
): { message: string; errors: ValidationIssue[] | undefined } {
  if (
    status === HttpStatus.BAD_REQUEST &&
    isMalformedUriMessage(message)
  ) {
    return { message: INVALID_URI_MESSAGE, errors: undefined };
  }

  if (
    status === HttpStatus.BAD_REQUEST &&
    isMalformedJsonParserMessage(message)
  ) {
    return { message: MALFORMED_JSON_MESSAGE, errors: undefined };
  }

  if (
    status === HttpStatus.NOT_FOUND &&
    isUnknownRouteMessage(message)
  ) {
    return { message: UNKNOWN_ROUTE_MESSAGE, errors };
  }

  if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
    return {
      message: 'Error interno del servidor.',
      errors: undefined,
    };
  }

  return { message, errors };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter<unknown> {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno del servidor.';
    let errors: ValidationIssue[] | undefined;
    let remainingCapacity: number | undefined;
    const bodyParserError = getBodyParserError(exception);

    if (bodyParserError) {
      status = bodyParserError.status;
      message = bodyParserError.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();

      if (status < HttpStatus.INTERNAL_SERVER_ERROR) {
        const exceptionResponse = exception.getResponse();

        if (typeof exceptionResponse === 'string') {
          message = exceptionResponse;
        } else {
          const payload = isRecord(exceptionResponse)
            ? exceptionResponse
            : undefined;
          const responseMessage = payload?.message;
          const responseCapacity = payload?.remainingCapacity;

          if (typeof responseMessage === 'string') {
            message = responseMessage;
          } else if (Array.isArray(responseMessage)) {
            message = 'Los datos enviados no son válidos.';
          }

          errors = getValidationIssues(payload?.errors);
          if (
            typeof responseCapacity === 'number' &&
            Number.isSafeInteger(responseCapacity) &&
            responseCapacity >= 0
          ) {
            remainingCapacity = responseCapacity;
          }
        }
      }
    }

    ({ message, errors } = normalizeErrorDetails(status, message, errors));

    if (status === HttpStatus.NO_CONTENT) {
      response.status(status).send();
      return;
    }

    const body: ApiErrorBody = {
      code: status,
      message,
      ...(errors ? { errors } : {}),
      ...(remainingCapacity !== undefined ? { remainingCapacity } : {}),
    };

    response.status(status).json(body);
  }
}
