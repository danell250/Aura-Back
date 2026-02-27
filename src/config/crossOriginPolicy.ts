const RELAXED_CROSS_ORIGIN_PATH_PREFIXES = [
  '/payment-success',
  '/payment-cancelled',
  '/api/auth/google',
  '/api/auth/github',
  '/api/auth/linkedin',
  '/api/auth/discord',
];

export const requiresRelaxedCrossOriginPolicy = (requestPath: string): boolean => {
  return RELAXED_CROSS_ORIGIN_PATH_PREFIXES.some((prefix) => requestPath.startsWith(prefix));
};
