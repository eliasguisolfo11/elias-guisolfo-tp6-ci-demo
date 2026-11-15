import type { AuthUser } from '../auth-user.entity.js';

export class AuthUserResponseDto {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly role: AuthUser['role'];

  constructor(user: AuthUser) {
    this.id = user.id;
    this.username = user.username;
    this.email = user.email;
    this.role = user.role;
  }
}
