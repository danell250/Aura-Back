import crypto from 'crypto';

const ROOM_NAME_SALT =
  String(process.env.SOCKET_ROOM_SALT || process.env.JWT_SECRET || 'aura-room-salt').trim() ||
  'aura-room-salt';

const normalizeCompanyId = (companyId: string): string => String(companyId || '').trim();

export const getCompanyApplicationRoom = (companyId: string): string => {
  const normalizedCompanyId = normalizeCompanyId(companyId);
  const digest = crypto
    .createHash('sha256')
    .update(`${ROOM_NAME_SALT}:${normalizedCompanyId}`)
    .digest('hex')
    .slice(0, 24);

  return `company-app-${digest}`;
};

