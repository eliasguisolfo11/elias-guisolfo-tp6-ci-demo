import { afterAll, expect } from 'vitest';
import { createAuthTestContext, AUTH_TEST_JWT_SECRET } from './helpers/auth-test-context.js';
import { createTemporaryDatabase } from './helpers/temp-database.js';
import { createTemporaryReservationsDatabase } from './helpers/temp-reservations-database.js';
import { createTemporaryReservationsCoordinationDatabase } from './helpers/temp-reservations-coordination-database.js';

const previousDatabasePath = process.env.DATABASE_PATH;
const previousJwtSecret = process.env.JWT_SECRET;
const previousAuthDatabasePath = process.env.AUTH_DATABASE_PATH;
const previousReservationsDatabasePath = process.env.RESERVATIONS_DATABASE_PATH;
const previousReservationsCoordinationDatabasePath =
  process.env.RESERVATIONS_COORDINATION_DATABASE_PATH;
const temporaryDatabase = createTemporaryDatabase();
const temporaryReservationsDatabase = createTemporaryReservationsDatabase();
const temporaryReservationsCoordinationDatabase =
  createTemporaryReservationsCoordinationDatabase();
const authTestContext = createAuthTestContext();
process.env.DATABASE_PATH = temporaryDatabase.path;
process.env.JWT_SECRET = AUTH_TEST_JWT_SECRET;
process.env.AUTH_DATABASE_PATH = authTestContext.path;
process.env.RESERVATIONS_DATABASE_PATH = temporaryReservationsDatabase.path;
process.env.RESERVATIONS_COORDINATION_DATABASE_PATH =
  temporaryReservationsCoordinationDatabase.path;

afterAll(() => {
  authTestContext.cleanup();
  temporaryDatabase.cleanup();
  temporaryReservationsDatabase.cleanup();
  temporaryReservationsCoordinationDatabase.cleanup();
  if (previousDatabasePath === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = previousDatabasePath;
  }

  if (previousAuthDatabasePath === undefined) {
    delete process.env.AUTH_DATABASE_PATH;
  } else {
    process.env.AUTH_DATABASE_PATH = previousAuthDatabasePath;
  }

  if (previousReservationsDatabasePath === undefined) {
    delete process.env.RESERVATIONS_DATABASE_PATH;
  } else {
    process.env.RESERVATIONS_DATABASE_PATH = previousReservationsDatabasePath;
  }

  if (previousReservationsCoordinationDatabasePath === undefined) {
    delete process.env.RESERVATIONS_COORDINATION_DATABASE_PATH;
  } else {
    process.env.RESERVATIONS_COORDINATION_DATABASE_PATH =
      previousReservationsCoordinationDatabasePath;
  }

  if (previousJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = previousJwtSecret;
  }

  expect(process.env.DATABASE_PATH).toBe(previousDatabasePath);
  expect(process.env.AUTH_DATABASE_PATH).toBe(previousAuthDatabasePath);
  expect(process.env.RESERVATIONS_DATABASE_PATH).toBe(
    previousReservationsDatabasePath,
  );
  expect(process.env.RESERVATIONS_COORDINATION_DATABASE_PATH).toBe(
    previousReservationsCoordinationDatabasePath,
  );
  expect(process.env.JWT_SECRET).toBe(previousJwtSecret);
});
