import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorDetail {
  @ApiProperty({
    type: String,
    description: 'Nombre del campo que contiene el error.',
    example: 'Name',
  })
  field!: string;

  @ApiProperty({
    type: String,
    description: 'Descripción del error encontrado en el campo.',
    example: 'El campo Name es obligatorio.',
  })
  message!: string;
}

export class ApiErrorResponse {
  @ApiProperty({
    type: 'integer',
    description: 'Código HTTP del error.',
    example: 400,
  })
  code!: number;

  @ApiProperty({
    type: String,
    description: 'Descripción general del error.',
    example: 'Los datos enviados no son válidos.',
  })
  message!: string;

  @ApiProperty({
    type: () => ApiErrorDetail,
    isArray: true,
    required: false,
    description: 'Errores de validación por campo, cuando corresponda.',
  })
  errors?: ApiErrorDetail[];
}
