import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Roles } from './roles.decorator.js';
import { Public } from './public.decorator.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { LoginResponseDto } from './dto/login-response.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { AuthUserResponseDto } from './dto/auth-user-response.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Public()
  login(@Body() input: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(input);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Roles('admin')
  register(@Body() input: RegisterDto): Promise<AuthUserResponseDto> {
    return this.authService.register(input);
  }
}
