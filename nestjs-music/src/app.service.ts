import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): { message: string } {
    return { message: 'API del catálogo Chinook' };
  }
}
