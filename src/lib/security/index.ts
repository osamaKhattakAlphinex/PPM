/**
 * Security layer public surface — the Edge-safe half.
 *
 * `./action` is NOT re-exported here on purpose: it imports `server-only` and
 * reaches the DAL, so pulling it into this barrel would make `src/middleware.ts`
 * fail to build the moment it imported a header helper. Server actions import
 * it directly:
 *
 *     import { defineAction } from "@/lib/security/action";
 */

export {
  buildContentSecurityPolicy,
  buildRequestSecurityHeaders,
  buildStaticContentSecurityPolicy,
  generateNonce,
  staticSecurityHeaders,
  strictTransportSecurityHeader,
  STATIC_SECURITY_HEADERS,
  type CspOptions,
  type HeaderEntry,
} from "./headers";

export {
  apiSuccess,
  AppError,
  ConflictError,
  ERROR_CODES,
  fieldErrorsFrom,
  handleApiError,
  isAppError,
  logAppError,
  newRequestId,
  normaliseError,
  NotFoundError,
  RateLimitError,
  toApiErrorBody,
  ValidationError,
  withApiErrorHandling,
  type ApiBody,
  type ApiErrorBody,
  type ApiSuccessBody,
  type ErrorCode,
  type LogContext,
} from "./errors";

export {
  clientIpFrom,
  createRateLimiter,
  enforceRateLimit,
  mutationRateLimiter,
  rateLimitHeaders,
  resetAllRateLimits,
  sensitiveMutationRateLimiter,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitRule,
} from "./rate-limit";
