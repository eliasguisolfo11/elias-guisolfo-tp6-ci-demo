import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class ParseIdPipe implements PipeTransform<string, number | string> {
  transform(value: string): number {
    this.validate(value, false);
    return Number(value);
  }

  transformCatalogId(value: string): number | string {
    this.validate(value, true);
    const parsedValue = Number(value);
    return Number.isSafeInteger(parsedValue) ? parsedValue : value;
  }

  private validate(value: string, includeValidationErrors: boolean): void {
    if (!/^\d+$/.test(value)) {
      const message = 'El id debe ser un entero no negativo.';
      if (!includeValidationErrors) {
        throw new BadRequestException(message);
      }

      throw new BadRequestException({
        message,
        errors: [{ field: 'id', message }],
      });
    }
  }
}
