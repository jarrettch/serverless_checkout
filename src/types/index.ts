// --- Request Types ---

export interface CheckoutRequest {
  cartId: string;
  items: CartItem[];
  paymentMethodId: string;
  currency?: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

// --- Order Types ---

export type OrderStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface Order {
  orderId: string;
  cartId: string;
  status: OrderStatus;
  items: OrderItem[];
  pricing: Pricing;
  currency: string;
  paymentMethodId: string;
  payloadHash: string;
  createdAt: string;
  completedAt?: string;
  errorDetails?: ErrorDetails;
  ttl: number;
}

export interface OrderItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Pricing {
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

// --- Payment Types ---

export interface CapturePaymentParams {
  paymentMethodId: string;
  amount: number;
  currency: string;
  orderId: string;
  metadata?: Record<string, string>;
}

export interface CapturePaymentResult {
  success: boolean;
  transactionId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface PaymentProvider {
  capturePayment(params: CapturePaymentParams): Promise<CapturePaymentResult>;
}

// --- Error Types ---

export interface ErrorDetails {
  orderId?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: ErrorDetails;
  };
}

// --- API Response ---

export interface CheckoutSuccessResponse {
  orderId: string;
  cartId: string;
  status: 'COMPLETED';
  items: OrderItem[];
  pricing: Pricing;
  currency: string;
  createdAt: string;
  completedAt: string;
}
