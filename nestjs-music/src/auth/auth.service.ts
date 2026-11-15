import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthRepository } from './auth.repository.js';
import { AuthUserResponseDto } from './dto/auth-user-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { LoginResponseDto } from './dto/login-response.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { PasswordHasher } from './password-hasher.js';

const INVALID_CREDENTIALS_MESSAGE = 'Se requieren credenciales válidas.';
const DEFAULT_JWT_EXPIRES_IN = '60m';

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(input: LoginDto): Promise<LoginResponseDto> {
    const user = this.repository.findByUsername(input.username);
    if (!user?.enabled) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const passwordMatches = await this.passwordHasher.verify(
      user.passwordHash,
      input.password,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const accessToken = await this.jwtService.signAsync(
      { sub: String(user.id) },
      { expiresIn: parseJwtExpiresIn(this.configService.get<string>('JWT_EXPIRES_IN')) },
    );

    return new LoginResponseDto(accessToken, user);
  }

  async register(input: RegisterDto): Promise<AuthUserResponseDto> {
    const username = input.username.trim();
    const email = input.email.trim();
    const passwordHash = await this.passwordHasher.hash(input.password);
    const created = this.repository.create({
      username,
      email,
      passwordHash,
      role: 'viewer',
      enabled: true,
    });

    return new AuthUserResponseDto(created);
  }
}

function parseJwtExpiresIn(configuredValue: string | undefined): number {
  const value = configuredValue?.trim() || DEFAULT_JWT_EXPIRES_IN;
  const match = /^(\d+)\s*(s|m|h|d|w)$/iu.exec(value);
  if (!match) {
    throw new Error(
      'JWT_EXPIRES_IN debe ser una duración positiva en s, m, h, d o w.',
    );
  }

  const amount = Number(match[1]);
  const secondsPerUnit: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
    w: 7 * 24 * 60 * 60,
  };
  const expiresInSeconds = amount * secondsPerUnit[match[2].toLowerCase()];

  if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error('JWT_EXPIRES_IN debe ser una duración positiva válida.');
  }

  return expiresInSeconds;
}
