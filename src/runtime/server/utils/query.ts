// Pure helpers for parsing inbound query-string params on the AIDP
// route handlers. Framework-agnostic — throws QueryError that route
// factories convert into a Response.

export class QueryError extends Error {
  statusCode: number
  statusMessage: string
  constructor(statusCode: number, statusMessage: string) {
    super(statusMessage)
    this.name = 'QueryError'
    this.statusCode = statusCode
    this.statusMessage = statusMessage
  }
}

/**
 * Parse an optional positive-integer query value (>= 1). Returns
 * undefined when the input is unset; throws QueryError(400) for
 * arrays, non-integers, zero, or negative numbers.
 *
 * `page=0` is rejected (the server normalises it but a fast-fail at
 * the SDK layer surfaces the customer's mistake immediately).
 */
export function parsePositiveInt(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value)) {
    throw new QueryError(400, `${name} must be a single value`)
  }
  const n = Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new QueryError(400, `${name} must be a positive integer (>= 1)`)
  }
  return n
}
