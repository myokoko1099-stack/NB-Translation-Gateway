import { ConfigError } from '../domain/errors.js';

const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * Wrapper that keeps a secret value out of logs, JSON and string
 * conversion. The only way to read the value is an explicit reveal().
 */
export class Secret {
  #value;

  constructor(value) {
    this.#value = value;
  }

  reveal() {
    return this.#value;
  }

  toString() {
    return '[REDACTED]';
  }

  toJSON() {
    return '[REDACTED]';
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return 'Secret([REDACTED])';
  }
}

/**
 * Secret management interface.
 * Implementations: EnvSecretProvider (below). A hosting-specific or
 * vault-backed provider can be added later without touching callers.
 *
 * Phase 05-B1 defines this interface but NO code reads any secret yet.
 *
 * @typedef {object} SecretProvider
 * @property {(name: string) => Secret | undefined} get
 * @property {(name: string) => Secret} require  throws ConfigError if missing
 */

/** Reads secrets from environment variables (set via hosting dashboard). */
export class EnvSecretProvider {
  #env;

  /** @param {Record<string, string | undefined>} env */
  constructor(env) {
    this.#env = env;
  }

  /** @returns {Secret | undefined} */
  get(name) {
    if (!SECRET_NAME.test(name)) {
      throw new ConfigError(['secret name must match [A-Z][A-Z0-9_]*']);
    }
    const value = this.#env[name];
    return value === undefined || value === '' ? undefined : new Secret(value);
  }

  /** @returns {Secret} */
  require(name) {
    const secret = this.get(name);
    if (!secret) {
      throw new ConfigError([`${name} is required`]);
    }
    return secret;
  }
}
