import { Request, Response } from 'express';
import { getDB } from '../db';
import { clearTokenCookies, verifyAccessToken, verifyRefreshToken } from './jwtUtils';

export const resolveLogoutUserId = (req: Request): string | null => {
  const attachedUserId = typeof (req as any)?.user?.id === 'string' ? (req as any).user.id.trim() : '';
  if (attachedUserId) return attachedUserId;

  const refreshToken = typeof req.cookies?.refreshToken === 'string' ? req.cookies.refreshToken : '';
  if (refreshToken) {
    const decodedRefresh = verifyRefreshToken(refreshToken);
    if (decodedRefresh?.id) return decodedRefresh.id;
  }

  const accessToken =
    typeof req.cookies?.accessToken === 'string'
      ? req.cookies.accessToken
      : req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : '';
  if (accessToken) {
    const decodedAccess = verifyAccessToken(accessToken);
    if (decodedAccess?.id) return decodedAccess.id;
  }

  const sessionUserId = (req.session as any)?.passport?.user;
  return typeof sessionUserId === 'string' && sessionUserId.trim().length > 0 ? sessionUserId : null;
};

export const invalidateUserAuthSessions = async (userId: string): Promise<void> => {
  const nowIso = new Date().toISOString();
  await getDB().collection('users').updateOne(
    { id: userId },
    {
      $set: {
        refreshTokens: [],
        authInvalidBefore: nowIso,
        lastActive: nowIso
      }
    }
  );
};

export const clearLogoutCookies = (res: Response): void => {
  clearTokenCookies(res);
  res.clearCookie('connect.sid', { path: '/' });
  if (process.env.COOKIE_DOMAIN) {
    res.clearCookie('connect.sid', { path: '/', domain: process.env.COOKIE_DOMAIN });
  }
};
