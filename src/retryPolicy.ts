/**
 * Retry Policy for Storage Operations
 *
 * Configurable retry logic with exponential backoff for Arweave/IPFS
 * uploads and fetches. Handles transient network failures gracefully.
 */

export interface RetryConfig {
  /** Maximum number of attempts (including the first) */
  maxAttempts: number;
  /** Initial delay between retries in ms */
  baseDelayMs: number;
  /** Maximum delay between retries in ms */
  maxDelayMs: number;
  /** Multiplier applied to delay after each retry */
  backoffFactor: number;
  /** Jitter range (0–1) to prevent thundering herd */
  jitter: number;
  /** Error codes that should NOT be retried */
  nonRetryableCodes: string[];
}

export interface RetryResult<T> {
  data: T;
  attempts: number;
  totalDelayMs: number;
}

/** Default retry config for storage operations. */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 15_000,
  backoffFactor: 2,
  jitter: 0.25,
  nonRetryableCodes: ["AUTH_FAILED", "NOT_FOUND", "INTEGRITY_MISMATCH"],
};

/**
 * Calculate delay for a given attempt with exponential backoff and jitter.
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig
): number {
  const exponential = config.baseDelayMs * Math.pow(config.backoffFactor, attempt);
  const capped = Math.min(exponential, config.maxDelayMs);
  const jitterRange = capped * config.jitter;
  const jitterOffset = (Math.random() - 0.5) * 2 * jitterRange;
  return Math.max(0, Math.round(capped + jitterOffset));
}

/**
 * Determine whether an error is retryable based on the config.
 */
export function isRetryable(
  error: unknown,
  config: RetryConfig
): boolean {
  if (error instanceof Error) {
    // Check for known non-retryable codes
    const code = (error as Error & { code?: string }).code;
    if (code && config.nonRetryableCodes.includes(code)) return false;

    // Network errors are always retryable
    const networkCodes = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN"];
    if (code && networkCodes.includes(code)) return true;

    // HTTP 429 (rate limited) and 5xx are retryable
    const status = (error as Error & { status?: number }).status;
    if (status === 429 || (status && status >= 500)) return true;
  }

  // Default: retry unknown errors
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry logic.
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => arweaveStore.put(buffer),
 *   { ...DEFAULT_RETRY_CONFIG, maxAttempts: 5 }
 * );
 * console.log(`Succeeded after ${result.attempts} attempt(s)`);
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<RetryResult<T>> {
  let lastError: unknown;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      const data = await fn();
      return { data, attempts: attempt + 1, totalDelayMs };
    } catch (err) {
      lastError = err;

      const isLastAttempt = attempt === config.maxAttempts - 1;
      if (isLastAttempt || !isRetryable(err, config)) {
        break;
      }

      const delay = calculateDelay(attempt, config);
      totalDelayMs += delay;
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Create a retry-wrapped version of an async function.
 */
export function withRetryPolicy<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): (...args: TArgs) => Promise<RetryResult<TResult>> {
  return (...args: TArgs) => withRetry(() => fn(...args), config);
}
