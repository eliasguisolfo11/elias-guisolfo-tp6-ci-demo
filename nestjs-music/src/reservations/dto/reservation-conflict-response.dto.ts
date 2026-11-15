import { ApiPropertyOptional } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../common/swagger/api-error-response.js';

export class ReservationConflictResponseDto extends ApiErrorResponse {
  @ApiPropertyOptional({
    type: 'integer',
    description: 'Cupos disponibles cuando la solicitud excede la capacidad.',
    example: 1,
  })
  readonly remainingCapacity?: number;
}
