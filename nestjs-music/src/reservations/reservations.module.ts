import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ReservationsDatabaseService } from './reservations.database.service.js';
import { ReservationsIdempotencyCoordinatorDatabaseService } from './reservations-idempotency-coordinator.database.service.js';
import { ReservationsIdempotencyCoordinatorService } from './reservations-idempotency-coordinator.service.js';
import { ReservationsSchemaService } from './reservations-schema.service.js';
import { SlotsRepository } from './slots.repository.js';
import { ReservationsRepository } from './reservations.repository.js';
import { PaymentsRepository } from './payments.repository.js';
import { PaymentSimulator } from './payment-simulator.js';
import { ReservationClock } from './reservation-clock.js';
import { ReservationsService } from './reservations.service.js';
import { ReservationsController } from './reservations.controller.js';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe.js';

@Module({
  imports: [ConfigModule],
  controllers: [ReservationsController],
  providers: [
    ReservationsDatabaseService,
    ReservationsIdempotencyCoordinatorDatabaseService,
    ReservationsIdempotencyCoordinatorService,
    ReservationsSchemaService,
    SlotsRepository,
    ReservationsRepository,
    PaymentsRepository,
    PaymentSimulator,
    ReservationClock,
    ReservationsService,
    ParseIdPipe,
  ],
  exports: [ReservationsDatabaseService, SlotsRepository],
})
export class ReservationsModule {}
