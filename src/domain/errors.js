/**
 * Error raised for conditions that map to an HTTP error response.
 * `message` and `details` are returned to the client, so they must never
 * contain secrets or internal paths.
 */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} code stable machine-readable error code
   * @param {string} message human-readable message (safe for clients)
   * @param {Array<{field?: string, issue: string}>} [details]
   * @param {Record<string,string>} [headers] extra response headers
   */
  constructor(status, code, message, details, headers) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

/** Raised at startup when configuration is missing or invalid. */
export class ConfigError extends Error {
  /** @param {string[]} problems one entry per problem; names only, never secret values */
  constructor(problems) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}
