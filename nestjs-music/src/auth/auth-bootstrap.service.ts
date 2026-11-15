import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';
import { AuthRepository } from './auth.repository.js';
import { AuthUser } from './auth-user.entity.js';
import { PasswordHasher } from './password-hasher.js';

@Injectable()
export class AuthBootstrapService {
  constructor(
    private readonly configService: ConfigService,
    private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async ensureInitialAdmin(): Promise<AuthUser | undefined> {
    if (this.repository.count() > 0) {
      return undefined;
    }

    const usernameValue: unknown = this.configService.get(
      'AUTH_BOOTSTRAP_ADMIN_USERNAME',
    );
    const emailValue: unknown = this.configService.get(
      'AUTH_BOOTSTRAP_ADMIN_EMAIL',
    );
    const passwordValue: unknown = this.configService.get(
      'AUTH_BOOTSTRAP_ADMIN_PASSWORD',
    );

    if (
      typeof usernameValue !== 'string' ||
      typeof emailValue !== 'string' ||
      typeof passwordValue !== 'string' ||
      usernameValue.length === 0 ||
      emailValue.length === 0 ||
      passwordValue.length === 0
    ) {
      throw new Error(
        'Complete bootstrap admin configuration is required for an empty auth database',
      );
    }

    const username = usernameValue.trim();
    const email = emailValue.trim();
    if (
      username.length === 0 ||
      username.length > 50 ||
      email.length === 0 ||
      email.length > 254 ||
      !isEmail(email) ||
      passwordValue.trim().length === 0 ||
      passwordValue.length < 8
    ) {
      throw new Error('Bootstrap admin configuration is invalid');
    }

    const passwordHash = await this.passwordHasher.hash(passwordValue);

    if (this.repository.count() > 0) {
      return undefined;
    }

    try {
      return this.repository.create({
        username,
        email,
        passwordHash,
        role: 'admin',
        enabled: true,
      });
    } catch (error) {
      if (error instanceof ConflictException && this.repository.count() > 0) {
        return undefined;
      }

      throw error;
    }
  }
}
