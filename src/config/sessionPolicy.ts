type SessionCookieSameSite = 'lax' | 'strict' | 'none';

type SessionCookiePolicyInput = {
  isProductionRuntime: boolean;
  configuredSameSite: string;
  configuredDomain: string;
  frontendUrl: string;
  backendUrl: string;
};

type SessionCookiePolicy = {
  secure: boolean;
  sameSite: SessionCookieSameSite;
  domain?: string;
  requiresCrossSiteCookie: boolean;
  supportsSecureCrossSiteCookie: boolean;
  downgradedFromNone: boolean;
  shouldEnableHsts: boolean;
};

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const isLocalHostname = (value: string): boolean =>
  value === 'localhost'
  || value === '127.0.0.1'
  || value === '::1'
  || value.endsWith('.local');

const normalizeSameSite = (value: string): SessionCookieSameSite | null => {
  if (value === 'none' || value === 'strict' || value === 'lax') {
    return value;
  }
  return null;
};

export const resolveSessionCookiePolicy = ({
  isProductionRuntime,
  configuredSameSite,
  configuredDomain,
  frontendUrl,
  backendUrl,
}: SessionCookiePolicyInput): SessionCookiePolicy => {
  const frontendUrlObject = parseUrl(frontendUrl);
  const backendUrlObject = parseUrl(backendUrl);
  const frontendHostname = frontendUrlObject?.hostname || '';
  const backendHostname = backendUrlObject?.hostname || '';
  const requiresCrossSiteCookie = !!frontendHostname && !!backendHostname && frontendHostname !== backendHostname;
  const supportsSecureCrossSiteCookie =
    frontendUrlObject?.protocol === 'https:'
    && backendUrlObject?.protocol === 'https:';
  const hasPublicHttpsOrigin = [frontendUrlObject, backendUrlObject].some((urlObject) =>
    !!urlObject
    && urlObject.protocol === 'https:'
    && !isLocalHostname(urlObject.hostname),
  );

  const explicitSameSite = normalizeSameSite(configuredSameSite);
  let sameSite: SessionCookieSameSite =
    explicitSameSite || ((isProductionRuntime || supportsSecureCrossSiteCookie) && requiresCrossSiteCookie ? 'none' : 'lax');
  let downgradedFromNone = false;
  if (sameSite === 'none' && !isProductionRuntime && !supportsSecureCrossSiteCookie) {
    sameSite = 'lax';
    downgradedFromNone = true;
  }
  const secure = isProductionRuntime || sameSite === 'none' || hasPublicHttpsOrigin;

  return {
    secure,
    sameSite,
    domain: configuredDomain || undefined,
    requiresCrossSiteCookie,
    supportsSecureCrossSiteCookie,
    downgradedFromNone,
    shouldEnableHsts: isProductionRuntime || hasPublicHttpsOrigin,
  };
};
