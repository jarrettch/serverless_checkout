export interface LogContext {
  requestId?: string;
  cartId?: string;
  orderId?: string;
  [key: string]: unknown;
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

let globalContext: LogContext = {};

export function setLogContext(context: LogContext): void {
  globalContext = { ...context };
}

function log(level: LogLevel, action: string, extra: Record<string, unknown> = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    ...globalContext,
    action,
    ...extra,
  };
  console.log(JSON.stringify(entry));
}

export function info(action: string, extra: Record<string, unknown> = {}): void {
  log('INFO', action, extra);
}

export function warn(action: string, extra: Record<string, unknown> = {}): void {
  log('WARN', action, extra);
}

export function error(action: string, extra: Record<string, unknown> = {}): void {
  log('ERROR', action, extra);
}
