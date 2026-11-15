import { Injectable } from '@nestjs/common';

export interface PaymentConfirmation {
  result: 'EXITOSO';
}

@Injectable()
export class PaymentSimulator {
  confirm(): PaymentConfirmation {
    return { result: 'EXITOSO' };
  }
}
