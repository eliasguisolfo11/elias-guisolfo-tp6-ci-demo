export type AuthUserRole = 'admin' | 'viewer';

export interface CreateAuthUserInput {
  username: string;
  email: string;
  passwordHash: string;
  role: AuthUserRole;
  enabled: boolean;
}

export class AuthUser {
  constructor(
    public readonly id: number,
    public readonly username: string,
    public readonly usernameNormalized: string,
    public readonly email: string,
    public readonly emailNormalized: string,
    public readonly passwordHash: string,
    public readonly role: AuthUserRole,
    public readonly enabled: boolean,
  ) {}
}
