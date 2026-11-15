import { Controller, Get } from '@nestjs/common';
import { Roles } from './auth/roles.decorator.js';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Roles('viewer', 'admin')
  getHello(): { message: string } {
    return this.appService.getHello();
  }
}
