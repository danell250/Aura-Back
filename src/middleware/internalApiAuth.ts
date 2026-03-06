import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const INTERNAL_KEY_ENV_KEYS = [
  'INTERNAL_API_KEYS',
  'INTERNAL_API_KEY',
  'JOB_AGGREGATOR_API_KEYS',
  'JOB_AGGREGATOR_API_KEY',
  'JOBS_INTERNAL_API_KEYS',
  'JOBS_INTERNAL_API_KEY',
] as const;

type InternalKeyMaterial = {
  digest: Buffer;
};

const readString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  return normalized;
};

const readFirstString = (value: unknown): string => {
  if (typeof value === 'string') return readString(value);
  if (Array.isArray(value) && typeof value[0] === 'string') return readString(value[0]);
  return '';
};

const normalizeTokenCandidate = (value: string): string => {
  if (!value) return '';
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
};

const parseConfiguredInternalKeys = (): Set<string> => {
  const keys = new Set<string>();
  for (const envKey of INTERNAL_KEY_ENV_KEYS) {
    const raw = process.env[envKey];
    if (typeof raw !== 'string' || raw.trim().length === 0) continue;
    raw
      .split(',')
      .map((entry) => normalizeTokenCandidate(readString(entry)))
      .filter((entry) => entry.length > 0)
      .forEach((entry) => keys.add(entry));
  }
  return keys;
};

const toDigest = (value: string): Buffer =>
  crypto.createHash('sha256').update(value).digest();

const buildInternalKeyMaterial = (): InternalKeyMaterial[] =>
  Array.from(parseConfiguredInternalKeys()).map((key) => ({
    digest: toDigest(key),
  }));

let configuredInternalKeyMaterial = buildInternalKeyMaterial();

const readInternalApiKeyFromRequest = (req: Request): string => {
  const headerKey = normalizeTokenCandidate(readFirstString(req.headers['x-internal-api-key']));
  if (headerKey) return headerKey;

  const apiHeaderKey = normalizeTokenCandidate(readFirstString(req.headers['x-api-key']));
  if (apiHeaderKey) return apiHeaderKey;

  const queryKey = normalizeTokenCandidate(readFirstString((req.query as any)?.apiKey));
  if (queryKey) return queryKey;

  const authHeader = readFirstString(req.headers.authorization);
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return normalizeTokenCandidate(authHeader.slice(7));
  }

  return '';
};

const isSuppliedKeyValid = (suppliedKey: string): boolean => {
  if (!suppliedKey || configuredInternalKeyMaterial.length === 0) return false;
  const suppliedDigest = toDigest(suppliedKey);
  return configuredInternalKeyMaterial.some((material) =>
    crypto.timingSafeEqual(material.digest, suppliedDigest),
  );
};

export const internalApiAuth = (req: Request, res: Response, next: NextFunction) => {
  const suppliedKey = readInternalApiKeyFromRequest(req);
  if (configuredInternalKeyMaterial.length === 0) {
    configuredInternalKeyMaterial = buildInternalKeyMaterial();
  }

  if (configuredInternalKeyMaterial.length === 0) {
    return res.status(503).json({
      success: false,
      error: 'Internal ingestion is not configured',
      message: 'No INTERNAL_API_KEY or INTERNAL_API_KEYS values are configured on this server',
    });
  }

  if (!isSuppliedKeyValid(suppliedKey)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid internal API key',
      message: 'Provide X-Internal-API-Key or Authorization: Bearer <key>',
    });
  }

  return next();
};
