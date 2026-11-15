import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AuthRepository } from '../../auth/auth.repository.js';
import { DocumentationAuthMiddleware } from '../../auth/documentation-auth.middleware.js';

const DOCUMENTED_HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
] as const;

const AUTHENTICATION_REQUIRED_DESCRIPTION =
  'Se requieren credenciales válidas.';
const ROLE_REQUIRED_DESCRIPTION =
  'El usuario no tiene permisos para esta operación.';

export function setupSwagger(app: INestApplication): void {
  const documentationAuthMiddleware = new DocumentationAuthMiddleware(
    app.get(JwtService),
    app.get(ConfigService),
    app.get(AuthRepository),
  );
  app.use(
    ['/docs', '/openapi.json'],
    documentationAuthMiddleware.use.bind(documentationAuthMiddleware),
  );

  const config = new DocumentBuilder()
    .setTitle('Catálogo Chinook')
    .setDescription('API REST para consultar y administrar el catálogo Chinook.')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  documentAuthentication(document);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'openapi.json',
  });
}

function documentAuthentication(
  document: ReturnType<typeof SwaggerModule.createDocument>,
): void {
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of DOCUMENTED_HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) {
        continue;
      }

      if (path === '/auth/login' && method === 'post') {
        operation.security = [];
        continue;
      }

      operation.security = [{ bearer: [] }];
      operation.responses['401'] ??= errorResponse(
        AUTHENTICATION_REQUIRED_DESCRIPTION,
      );

      if (
        method === 'post' ||
        method === 'patch' ||
        method === 'delete'
      ) {
        operation.responses['403'] ??= errorResponse(
          ROLE_REQUIRED_DESCRIPTION,
        );
      }
    }
  }
}

function errorResponse(description: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ApiErrorResponse' },
      },
    },
  };
}
