import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUserRole } from '../auth/auth-user.entity.js';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ReservationsDatabaseService } from './reservations.database.service.js';
import { SlotsRepository } from './slots.repository.js';
import { ReservationsRepository } from './reservations.repository.js';
import { PaymentsRepository } from './payments.repository.js';
import { PaymentSimulator } from './payment-simulator.js';
import { ReservationClock, parseOffsetDateTime } from './reservation-clock.js';
import { ReservationResponseDto } from './dto/reservation-response.dto.js';
import {
  ReservationsIdempotencyCoordinatorService,
  type CoordinatedHttpResponse,
} from './reservations-idempotency-coordinator.service.js';
import type {
  PublicReservationStatus,
  ReservationEntity,
  ReservationStatus,
} from './entities/reservation.entity.js';
import { CreateReservationDto } from './dto/create-reservation.dto.js';
import type { SlotAvailability } from './slots.repository.js';

const INVALID_STARTS_AT_MESSAGE =
  'La fecha y hora debe ser ISO válida e incluir un offset explícito.';
const INVALID_QUANTITY_MESSAGE = 'La cantidad debe ser un entero positivo.';

export interface CreateReservationInput {
  startsAt?: unknown;
  quantity?: unknown;
  estado?: unknown;
}

export interface ReservationReceipt extends Omit<ReservationEntity, 'status'> {
  status: PublicReservationStatus;
  payment: NonNullable<ReservationEntity['payment']>;
}

interface CoordinatedErrorBody {
  code: number;
  message: string;
  errors?: { field: string; message: string }[];
  remainingCapacity?: number;
}

const RESERVATION_NOT_FOUND_MESSAGE = 'No existe una reserva con ese id.';
const INVALID_TRANSITION_MESSAGE =
  'La transición solicitada no está permitida.';
const EARLY_COMPLETION_MESSAGE =
  'La reserva solo puede completarse desde el instante programado.';
const COMPLETION_FORBIDDEN_MESSAGE = 'Solo admin puede completar una reserva.';

interface CreateReservationFields {
  startsAt: string;
  quantity: number;
}

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasEstado(input: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(input, 'estado');
}

function canonicalizeJsonValue(value: unknown): JsonValue | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item) ?? null);
  }

  if (isRecord(value)) {
    const result: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      const canonicalValue = canonicalizeJsonValue(value[key]);
      if (canonicalValue !== undefined) {
        result[key] = canonicalValue;
      }
    }
    return result;
  }

  return undefined;
}

function serializeComparableInput(input: unknown): string | null {
  const canonicalInput = canonicalizeJsonValue(input);
  return canonicalInput === undefined
    ? null
    : (JSON.stringify(canonicalInput) ?? null);
}

function normalizePersistedInput(input: string): string | null {
  try {
    const parsedInput: unknown = JSON.parse(input);
    return serializeComparableInput(parsedInput);
  } catch {
    return null;
  }
}

function normalizeCreateException(exception: HttpException): CoordinatedErrorBody {
  const status = exception.getStatus();
  let message = 'Error interno del servidor.';
  let errors: { field: string; message: string }[] | undefined;
  let remainingCapacity: number | undefined;

  if (status < 500) {
    const response = exception.getResponse();
    if (typeof response === 'string') {
      message = response;
    } else if (isRecord(response)) {
      const responseMessage = response.message;
      if (typeof responseMessage === 'string') {
        message = responseMessage;
      } else if (Array.isArray(responseMessage)) {
        message = 'Los datos enviados no son válidos.';
      }

      if (Array.isArray(response.errors)) {
        const validErrors = response.errors.filter(
          (item): item is { field: string; message: string } =>
            isRecord(item) &&
            typeof item.field === 'string' &&
            typeof item.message === 'string',
        );
        errors = validErrors.length > 0 ? validErrors : undefined;
      }

      if (
        typeof response.remainingCapacity === 'number' &&
        Number.isSafeInteger(response.remainingCapacity) &&
        response.remainingCapacity >= 0
      ) {
        remainingCapacity = response.remainingCapacity;
      }
    }
  }

  return {
    code: status,
    message,
    ...(errors === undefined ? {} : { errors }),
    ...(remainingCapacity === undefined ? {} : { remainingCapacity }),
  };
}

function readCreateReservationFields(input: unknown): CreateReservationFields {
  if (!isRecord(input)) {
    throw new BadRequestException('El cuerpo de la reserva no es válido.');
  }

  if (hasEstado(input)) {
    throw new BadRequestException(
      'El estado de una reserva no puede definirse al crearla.',
    );
  }

  const dto = plainToInstance(CreateReservationDto, input);
  const validationErrors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
  if (validationErrors.length > 0) {
    if (validationErrors.some((error) => error.property === 'startsAt')) {
      throw new BadRequestException(INVALID_STARTS_AT_MESSAGE);
    }
    if (validationErrors.some((error) => error.property === 'quantity')) {
      throw new BadRequestException(INVALID_QUANTITY_MESSAGE);
    }

    throw new BadRequestException('El cuerpo de la reserva no es válido.');
  }

  return { startsAt: dto.startsAt, quantity: dto.quantity };
}

@Injectable()
export class ReservationsService {
  constructor(
    private readonly database: ReservationsDatabaseService,
    private readonly slotsRepository: SlotsRepository,
    private readonly reservationsRepository: ReservationsRepository,
    private readonly paymentsRepository: PaymentsRepository,
    private readonly clock: ReservationClock,
    private readonly paymentSimulator: PaymentSimulator,
    private readonly idempotencyCoordinator: ReservationsIdempotencyCoordinatorService,
  ) {}

  findSlots(): SlotAvailability[] {
    return this.slotsRepository.findAll();
  }

  findById(id: number, userId: number, role: AuthUserRole): ReservationReceipt {
    return this.findReservationForActor(id, userId, role);
  }

  cancel(id: number, userId: number, role: AuthUserRole): ReservationReceipt {
    return this.database.transactionImmediate(() => {
      const reservation = this.findReservationForActor(id, userId, role);
      if (reservation.status === 'CANCELADA') {
        return reservation;
      }

      if (reservation.status !== 'PAGADA') {
        throw new ConflictException(INVALID_TRANSITION_MESSAGE);
      }

      if (!this.reservationsRepository.transition(id, 'PAGADA', 'CANCELADA')) {
        throw new ConflictException(INVALID_TRANSITION_MESSAGE);
      }

      return this.findReservationForActor(id, userId, role);
    });
  }

  transition(
    id: number,
    userId: number,
    role: AuthUserRole,
    destination: ReservationStatus,
  ): ReservationReceipt {
    return this.database.transactionImmediate(() => {
      const reservation = this.findReservationForActor(id, userId, role);

      if (destination === 'COMPLETADA' && role !== 'admin') {
        throw new ForbiddenException(COMPLETION_FORBIDDEN_MESSAGE);
      }

      if (
        reservation.status !== 'PAGADA' ||
        (destination !== 'CANCELADA' && destination !== 'COMPLETADA')
      ) {
        throw new ConflictException(INVALID_TRANSITION_MESSAGE);
      }

      if (destination === 'COMPLETADA') {
        const scheduledAt = parseOffsetDateTime(reservation.startsAt);
        if (scheduledAt === undefined) {
          throw new Error('La fecha persistida de la reserva no es válida.');
        }

        if (this.clock.now().getTime() < scheduledAt.getTime()) {
          throw new ConflictException(EARLY_COMPLETION_MESSAGE);
        }
      }

      if (!this.reservationsRepository.transition(id, 'PAGADA', destination)) {
        throw new ConflictException(INVALID_TRANSITION_MESSAGE);
      }

      return this.findReservationForActor(id, userId, role);
    });
  }

  create(
    userId: number,
    idempotencyKey: string,
    input: unknown,
  ): ReservationReceipt {
    return this.database.transactionImmediate(() => {
      const existing =
        this.reservationsRepository.findSuccessfulByUserAndIdempotencyKey(
          userId,
          idempotencyKey,
        );
      if (existing !== null) {
        const comparableInput = serializeComparableInput(input);
        const storedInput = normalizePersistedInput(existing.requestPayload);
        if (comparableInput === null || comparableInput !== storedInput) {
          throw new ConflictException(
            'La clave de idempotencia ya se usó con otro contenido.',
          );
        }

        const payment = this.paymentsRepository.findByReservationId(
          existing.id,
        );
        if (payment === null) {
          throw new Error(
            'El pago exitoso no pudo recuperarse para el replay.',
          );
        }

        return {
          id: existing.id,
          userId: existing.userId,
          slotId: existing.slotId,
          startsAt: existing.startsAt,
          quantity: existing.quantity,
          status: 'PAGADA',
          createdAt: existing.createdAt,
          payment,
        };
      }

      const fields = readCreateReservationFields(input);
      const startsAtText = fields.startsAt;
      const startsAt = parseOffsetDateTime(startsAtText);
      if (startsAt === undefined) {
        throw new BadRequestException(INVALID_STARTS_AT_MESSAGE);
      }

      if (startsAt.getTime() <= this.clock.now().getTime()) {
        throw new BadRequestException('El turno debe estar en el futuro.');
      }

      const quantity = fields.quantity;
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new BadRequestException(INVALID_QUANTITY_MESSAGE);
      }

      const startsAtUtc = startsAt.toISOString();
      const requestPayload = serializeComparableInput(input);
      if (requestPayload === null) {
        throw new BadRequestException('El cuerpo de la reserva no es válido.');
      }

      const slot = this.slotsRepository.findForReservation(startsAtUtc);
      if (slot === null) {
        throw new NotFoundException(
          'No existe un turno para esa fecha y hora.',
        );
      }

      if (quantity > slot.remainingCapacity) {
        throw new ConflictException({
          message: 'La cantidad solicitada supera el cupo disponible.',
          remainingCapacity: slot.remainingCapacity,
        });
      }

      const reservationId = this.reservationsRepository.createPending({
        userId,
        slotId: slot.id,
        quantity,
        idempotencyKey,
        requestPayload,
      });

      let paymentResult: ReturnType<PaymentSimulator['confirm']>;
      try {
        paymentResult = this.paymentSimulator.confirm();
      } catch {
        throw new BadGatewayException('El pago simulado no pudo confirmarse.');
      }

      if (paymentResult.result !== 'EXITOSO') {
        throw new BadGatewayException('El pago simulado no pudo confirmarse.');
      }

      const payment = this.paymentsRepository.recordSuccessful(reservationId);
      this.reservationsRepository.markPaid(reservationId);
      const reservation = this.reservationsRepository.findById(reservationId);
      if (reservation === null || reservation.status !== 'PAGADA') {
        throw new Error(
          'La reserva no pudo recuperarse después de confirmarla.',
        );
      }

      return { ...reservation, status: 'PAGADA', payment };
    });
  }

  createCoordinated(
    userId: number,
    idempotencyKey: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<CoordinatedHttpResponse> {
    const canonicalContent = serializeComparableInput(input) ?? 'undefined';

    return this.idempotencyCoordinator.coordinate(
      userId,
      idempotencyKey,
      canonicalContent,
      () => {
        try {
          const reservation = this.create(userId, idempotencyKey, input);
          return {
            status: 201,
            body: new ReservationResponseDto(reservation),
          };
        } catch (error) {
          if (
            error instanceof HttpException &&
            [400, 404, 409, 502].includes(error.getStatus())
          ) {
            return {
              status: error.getStatus(),
              body: normalizeCreateException(error),
            };
          }

          throw error;
        }
      },
      signal,
    );
  }

  private findReservationForActor(
    id: number,
    userId: number,
    role: AuthUserRole,
  ): ReservationReceipt {
    const reservation = this.reservationsRepository.findWithPaymentById(id);
    if (
      reservation === null ||
      (role === 'viewer' && reservation.userId !== userId)
    ) {
      throw new NotFoundException(RESERVATION_NOT_FOUND_MESSAGE);
    }

    return reservation;
  }
}
