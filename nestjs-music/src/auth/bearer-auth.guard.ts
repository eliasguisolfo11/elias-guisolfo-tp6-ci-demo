import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { AuthRepository } from './auth.repository.js';
import type { AuthUserRole } from './auth-user.entity.js';
import { PUBLIC_ROUTE_METADATA_KEY } from './public.decorator.js';

const INVALID_CREDENTIALS_MESSAGE = 'Se requieren credenciales válidas.';
const BEARER_CHALLENGE = 'Bearer';

export interface AuthenticatedUser {
  id: number;
  role: AuthUserRole;
  enabled: boolean;
}

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

interface JwtClaims {
  sub?: unknown;
}

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly authRepository: AuthRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const token = this.getBearerToken(request.headers.authorization);
    const secret = this.configService.get<string>('JWT_SECRET');

    if (!token || !secret || secret.trim().length === 0) {
      this.rejectUnauthorized(response);
    }

    let claims: JwtClaims;
    try {
      claims = await this.jwtService.verifyAsync<JwtClaims>(token, { secret });
    } catch {
      this.rejectUnauthorized(response);
    }

    const userId = parseSubject(claims.sub);
    if (userId === undefined) {
      this.rejectUnauthorized(response);
    }

    const user = this.authRepository.findById(userId);
    if (!user?.enabled) {
      this.rejectUnauthorized(response);
    }

    request.user = { id: user.id, role: user.role, enabled: user.enabled };
    return true;
  }

  private getBearerToken(authorization: string | undefined): string | undefined {
    return authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  }

  private rejectUnauthorized(response: Response): never {
    response.setHeader('WWW-Authenticate', BEARER_CHALLENGE);
    throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
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
