import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const PARTNER_KEY_ENV_KEYS = [
  'PARTNER_API_KEYS',
  'PARTNER_API_KEY',
  'JOBS_PARTNER_API_KEYS',
  'JOBS_PARTNER_API_KEY',
] as const;

type PartnerKeyMaterial = {
  key: string;
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

const parseConfiguredPartnerKeys = (): Set<string> => {
  const keys = new Set<string>();
  for (const envKey of PARTNER_KEY_ENV_KEYS) {
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

const buildPartnerKeyMaterial = (): PartnerKeyMaterial[] =>
  Array.from(parseConfiguredPartnerKeys()).map((key) => ({
    key,
    digest: toDigest(key),
  }));

let configuredPartnerKeyMaterial = buildPartnerKeyMaterial();

const readPartnerApiKeyFromRequest = (req: Request): string => {
  const queryKey = normalizeTokenCandidate(readFirstString((req.query as any)?.apiKey));
  if (queryKey) return queryKey;

  const headerKey = normalizeTokenCandidate(readFirstString(req.headers['x-api-key']));
  if (headerKey) return headerKey;

  const authHeader = readFirstString(req.headers.authorization);
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return normalizeTokenCandidate(authHeader.slice(7));
  }

  return '';
};

const isSuppliedKeyValid = (suppliedKey: string): boolean => {
  if (!suppliedKey || configuredPartnerKeyMaterial.length === 0) return false;
  const suppliedDigest = toDigest(suppliedKey);
  return configuredPartnerKeyMaterial.some((material) =>
    crypto.timingSafeEqual(material.digest, suppliedDigest),
  );
};

export const partnerAuth = (req: Request, res: Response, next: NextFunction) => {
  const suppliedKey = readPartnerApiKeyFromRequest(req);
  if (configuredPartnerKeyMaterial.length === 0) {
    configuredPartnerKeyMaterial = buildPartnerKeyMaterial();
  }

  if (configuredPartnerKeyMaterial.length === 0) {
    return res.status(503).json({
      success: false,
      error: 'Partner syndication is not configured',
      message: 'No partner API keys are configured on this server',
    });
  }

  if (!isSuppliedKeyValid(suppliedKey)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid partner API key',
      message: 'Provide a valid partner API key in ?apiKey= or x-api-key',
    });
  }

  return next();
};
