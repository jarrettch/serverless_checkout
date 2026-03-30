import { PaymentProvider, CapturePaymentParams, CapturePaymentResult } from '../types';
import { randomUUID } from 'crypto';

export class MockPaymentProvider implements PaymentProvider {
  async capturePayment(params: CapturePaymentParams): Promise<CapturePaymentResult> {
    const { paymentMethodId } = params;

    if (paymentMethodId.startsWith('pm_fail_insufficient_funds')) {
      return {
        success: false,
        errorCode: 'insufficient_funds',
        errorMessage: 'The card has insufficient funds',
      };
    }

    if (paymentMethodId.startsWith('pm_fail_card_declined')) {
      return {
        success: false,
        errorCode: 'card_declined',
        errorMessage: 'The card was declined',
      };
    }

    if (paymentMethodId.startsWith('pm_fail_')) {
      return {
        success: false,
        errorCode: 'generic_error',
        errorMessage: 'Payment failed',
      };
    }

    return {
      success: true,
      transactionId: `txn_${randomUUID()}`,
    };
  }
}
