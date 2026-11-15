import { ConfigService } from '@nestjs/config';
import { createTemporaryAuthDatabase } from '../../test/helpers/temp-auth-database.js';
import { AuthDatabaseService } from './auth-database.service.js';
import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('creates Argon2id hashes with unique generated salts and the approved cost', async () => {
    const password = 'correct horse battery staple';

    const firstHash = await hasher.hash(password);
    const secondHash = await hasher.hash(password);

    expect(firstHash).not.toBe(password);
    expect(firstHash).not.toBe(secondHash);
    expect(firstHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
  });

  it('verifies the matching password and rejects a different one', async () => {
    const password = 'correct horse battery staple';
    const passwordHash = await hasher.hash(password);

    await expect(hasher.verify(passwordHash, password)).resolves.toBe(true);
    await expect(
      hasher.verify(passwordHash, 'a different password'),
    ).resolves.toBe(false);
  });

  it('persists and verifies the encoded hash without storing the password', async () => {
    const temporaryDatabase = createTemporaryAuthDatabase();
    const database = new AuthDatabaseService(
      new ConfigService({ AUTH_DATABASE_PATH: temporaryDatabase.path }),
    );
    const password = 'correct horse battery staple';

    try {
      database.run(
        'CREATE TABLE PasswordProbe (PasswordHash TEXT NOT NULL)',
      );
      const passwordHash = await hasher.hash(password);
      database.run(
        'INSERT INTO PasswordProbe (PasswordHash) VALUES (?)',
        passwordHash,
      );
      const persisted = database.get<{ PasswordHash: string }>(
        'SELECT PasswordHash FROM PasswordProbe',
      );

      expect(persisted?.PasswordHash).toBe(passwordHash);
      expect(persisted?.PasswordHash).not.toContain(password);
      await expect(
        hasher.verify(persisted?.PasswordHash ?? '', password),
      ).resolves.toBe(true);
    } finally {
      database.onModuleDestroy();
      temporaryDatabase.cleanup();
    }
  });
});
