import crypto from 'crypto';

/**
 * Generates a cryptographically strong random hex string.
 * Used for magic links and other one-time tokens.
 */
export function generateMagicToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hashes a token using SHA-256.
 * We store the hash in the DB, not the raw token.
 */
export function hashToken(token: string): string {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
}
