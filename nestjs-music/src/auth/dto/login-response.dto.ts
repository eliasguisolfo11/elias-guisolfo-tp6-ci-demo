import type { AuthUser } from '../auth-user.entity.js';
import { AuthUserResponseDto } from './auth-user-response.dto.js';

export class LoginResponseDto {
  readonly accessToken: string;
  readonly user: AuthUserResponseDto;

  constructor(accessToken: string, user: AuthUser) {
    this.accessToken = accessToken;
    this.user = new AuthUserResponseDto(user);
  }
}
