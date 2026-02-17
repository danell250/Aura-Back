import { NextFunction, Request, Response } from 'express';

interface CsrfProtectionOptions {
  allowedOrigins: string[];
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const normalizeOrigin = (value: string): string => value.trim().replace(/\/$/, '').toLowerCase();

const parseRefererOrigin = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) return '';
  try {
    return normalizeOrigin(new URL(value).origin);
  } catch {
    return '';
  }
};

const isCsrfEnforced = (): boolean =>
  process.env.CSRF_PROTECTION_ENABLED === 'true' ||
  process.env.NODE_ENV === 'production';

export const createCsrfProtection = (options: CsrfProtectionOptions) => {
  const trustedOrigins = new Set(
    options.allowedOrigins
      .filter((origin) => typeof origin === 'string' && origin.trim().length > 0)
      .map(normalizeOrigin)
  );

  return (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
      return next();
    }

    const hasSessionCookie =
      !!req.cookies?.accessToken ||
      !!req.cookies?.refreshToken ||
      !!req.cookies?.['connect.sid'];

    // CSRF is relevant for browser-cookie sessions only.
    if (!hasSessionCookie) {
      return next();
    }

    const origin = typeof req.headers.origin === 'string'
      ? normalizeOrigin(req.headers.origin)
      : '';
    const refererOrigin = parseRefererOrigin(req.headers.referer);
    const requestOrigin = origin || refererOrigin;

    if (requestOrigin && trustedOrigins.has(requestOrigin)) {
      return next();
    }

    if (!isCsrfEnforced()) {
      console.warn('[CSRF] Non-production request missing trusted origin. Allowed due scaffold mode.', {
        method: req.method,
        path: req.originalUrl,
        origin: origin || null,
        refererOrigin: refererOrigin || null
      });
      return next();
    }

    return res.status(403).json({
      success: false,
      error: 'CSRF validation failed',
      message: 'Request origin is not allowed for cookie-authenticated write operation'
    });
  };
};
