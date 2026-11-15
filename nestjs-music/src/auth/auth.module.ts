import {
  Injectable,
  Module,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthBootstrapService } from './auth-bootstrap.service.js';
import { AuthDatabaseService } from './auth-database.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { BearerAuthGuard } from './bearer-auth.guard.js';
import { PasswordHasher } from './password-hasher.js';
import { RolesGuard } from './roles.guard.js';

@Injectable()
class AuthBootstrapLifecycle implements OnApplicationBootstrap {
  constructor(private readonly authBootstrapService: AuthBootstrapService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.authBootstrapService.ensureInitialAdmin();
  }
}

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthDatabaseService,
    AuthRepository,
    { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
    AuthService,
    AuthBootstrapService,
    AuthBootstrapLifecycle,
    BearerAuthGuard,
    RolesGuard,
    { provide: APP_GUARD, useExisting: BearerAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
})
export class AuthModule {}
