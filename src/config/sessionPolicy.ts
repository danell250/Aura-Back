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
};

const getHostnameFromUrl = (value: string): string => {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
};

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
  const frontendHostname = getHostnameFromUrl(frontendUrl);
  const backendHostname = getHostnameFromUrl(backendUrl);
  const requiresCrossSiteCookie = !!frontendHostname && !!backendHostname && frontendHostname !== backendHostname;

  const explicitSameSite = normalizeSameSite(configuredSameSite);
  const sameSite: SessionCookieSameSite =
    explicitSameSite || (isProductionRuntime && requiresCrossSiteCookie ? 'none' : 'lax');
  const secure = isProductionRuntime || sameSite === 'none';

  return {
    secure,
    sameSite,
    domain: configuredDomain || undefined,
    requiresCrossSiteCookie,
  };
};
