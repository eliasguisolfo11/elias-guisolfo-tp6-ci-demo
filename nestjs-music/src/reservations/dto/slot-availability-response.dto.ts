import { ApiProperty } from '@nestjs/swagger';
import type { SlotAvailability } from '../slots.repository.js';

export class SlotAvailabilityResponseDto implements SlotAvailability {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Fecha y hora configurada del turno, con su offset original.',
    example: '2026-12-15T10:00:00-03:00',
  })
  readonly startsAt: string;

  @ApiProperty({
    type: 'integer',
    description: 'Capacidad fija del turno.',
    example: 4,
  })
  readonly capacity: number;

  @ApiProperty({
    type: 'integer',
    description: 'Cupos disponibles, calculados desde las reservas que ocupan capacidad.',
    example: 2,
  })
  readonly remainingCapacity: number;

  constructor(slot: SlotAvailability) {
    this.startsAt = slot.startsAt;
    this.capacity = slot.capacity;
    this.remainingCapacity = slot.remainingCapacity;
  }
}
