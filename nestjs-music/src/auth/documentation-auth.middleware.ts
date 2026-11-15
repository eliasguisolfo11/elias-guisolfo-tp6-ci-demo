import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import { AuthRepository } from './auth.repository.js';

const INVALID_CREDENTIALS_MESSAGE = 'Se requieren credenciales válidas.';
const BEARER_CHALLENGE = 'Bearer';

interface JwtClaims {
  sub?: unknown;
}

export class DocumentationAuthMiddleware {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authRepository: AuthRepository,
  ) {}

  async use(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    const token = request.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const secret = this.configService.get<string>('JWT_SECRET');

    if (!token || !secret || secret.trim().length === 0) {
      this.rejectUnauthorized(response);
      return;
    }

    let claims: JwtClaims;
    try {
      claims = await this.jwtService.verifyAsync<JwtClaims>(token, { secret });
    } catch {
      this.rejectUnauthorized(response);
      return;
    }

    const userId = parseSubject(claims.sub);
    if (userId === undefined) {
      this.rejectUnauthorized(response);
      return;
    }

    const user = this.authRepository.findById(userId);
    if (!user?.enabled) {
      this.rejectUnauthorized(response);
      return;
    }

    next();
  }

  private rejectUnauthorized(response: Response): void {
    response.setHeader('WWW-Authenticate', BEARER_CHALLENGE);
    response.status(401).json({
      code: 401,
      message: INVALID_CREDENTIALS_MESSAGE,
    });
  }
}

function parseSubject(subject: unknown): number | undefined {
  if (typeof subject === 'number') {
    return Number.isSafeInteger(subject) && subject > 0 ? subject : undefined;
  }

  if (typeof subject !== 'string' || !/^[1-9]\d*$/.test(subject)) {
    return undefined;
  }

  const userId = Number(subject);
  return Number.isSafeInteger(userId) ? userId : undefined;
}
