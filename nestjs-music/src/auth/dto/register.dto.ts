import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  username!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsDefined()
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsDefined()
  @IsString()
  @MinLength(8)
  @Matches(/\S/u)
  password!: string;

  @IsIn([undefined], { message: 'No se permite definir el rol.' })
  role?: unknown;
}
