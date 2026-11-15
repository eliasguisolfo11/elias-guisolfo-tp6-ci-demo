import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsString,
  Matches,
} from 'class-validator';

export class LoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/u)
  password!: string;
}
