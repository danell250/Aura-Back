const DEFAULT_PUBLIC_WEB_URL =
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:5003'
    : 'https://www.aurasocial.world';

const normalizeUrl = (value: string): string => value.trim().replace(/\/$/, '');

export const getPublicWebUrl = (): string => {
  const configured =
    process.env.PUBLIC_WEB_URL ||
    process.env.PUBLIC_AUTH_BASE_URL ||
    '';

  if (configured && configured.trim().length > 0) {
    return normalizeUrl(configured);
  }

  return DEFAULT_PUBLIC_WEB_URL;
};

export const buildPublicAuthCallbackUrl = (provider: 'google' | 'github' | 'linkedin' | 'discord'): string =>
  `${getPublicWebUrl()}/api/auth/${provider}/callback`;
