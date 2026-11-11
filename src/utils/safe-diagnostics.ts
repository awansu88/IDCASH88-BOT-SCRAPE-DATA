import { createHash } from 'crypto';

/** Stable correlation only. Never render the original profile/operational identifier. */
export function profileTag(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : 'unknown').digest('hex').slice(0, 12);
}

// Diagnostic allowlist only; these values never participate in failure decisions.
const SAFE_CODES = new Set([
  'AUTO', 'FAST', 'LEGACY', 'UNKNOWN', 'INJECTED', 'EXPLICIT', 'FAST_READY',
  'BROWSER_PAGE_UNAVAILABLE', 'BROWSER_PAGE_CLOSED', 'REQUEST_CONTEXT_UNAVAILABLE',
  'BROWSER_URL_UNAVAILABLE', 'INVALID_BROWSER_ORIGIN', 'END_OF_PAGINATION',
  'MAX_SCAN_REACHED', 'FULL_DUPLICATE_PAGE', 'STOP_REQUESTED', 'NAVIGATION_FAILURE',
  'BROWSER_FAILURE', 'HTTP_FAILURE', 'SESSION_EXPIRED', 'UNSAFE_RESPONSE',
  'REQUEST_FORM_MISSING', 'REQUEST_PARAMETER_MISSING', 'REQUEST_METHOD_UNSUPPORTED',
  'REQUEST_URL_INVALID', 'REQUEST_ORIGIN_UNSAFE', 'REQUEST_BROWSER_METADATA_UNAVAILABLE',
  'FAST_WORKER_BUSY', 'PROFILE_PAYMENT_CONFLICT', 'PAYMENT_UNAVAILABLE', 'PAYMENT_AMBIGUOUS',
  'STATUS_UNAVAILABLE', 'STATUS_AMBIGUOUS', 'AGENT_UNAVAILABLE', 'AGENT_AMBIGUOUS',
  'AGENT_CONTROL_UNSUPPORTED', 'MANUAL_DATE_REQUIRED', 'RUNTIME_CONTROL_UNAVAILABLE',
  'UNKNOWN_CYCLE_FATAL', 'TABLE_NOT_FOUND', 'LOGIN_RESPONSE', 'PERMISSION_RESPONSE',
  'UNKNOWN_LAYOUT', 'INVALID_AMOUNT', 'INVALID_PROCESS_DATE', 'MISSING_REQUIRED_FIELD',
  'SCHEMA_CONFLICT', 'FOOTER_ROW', 'PAGINATION_AMBIGUOUS', 'SNAPSHOT_FAILED',
]);
export function diagnosticCode(value: unknown): string {
  return typeof value === 'string' && SAFE_CODES.has(value) ? value : 'UNKNOWN';
}
export function diagnosticCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
/** Fresh error: no original message, name, stack, cause, or enumerable properties. */
export function diagnosticError(error: unknown): Error {
  const value = error as { terminationReason?: unknown; code?: unknown } | null;
  return new Error(`Operation failed (${diagnosticCode(value?.terminationReason ?? value?.code)})`);
}
