import { Db } from 'mongodb';
import { createNotificationInDB } from '../controllers/notificationsController';
import { recordOpenToWorkInviteMetric } from './openToWorkMetricsService';
import { readString } from '../utils/inputSanitizers';

export const createInviteToApplyNotification = async (params: {
  db: Db;
  candidateUserId: string;
  companyId: string;
  companyHandle?: string;
  invitedByUserId?: string;
}) => {
  const candidateUserId = readString(params.candidateUserId, 120);
  const companyId = readString(params.companyId, 120);
  if (!candidateUserId || !companyId) return null;

  const notification = await createNotificationInDB(
    candidateUserId,
    'invite_to_apply',
    companyId,
    'invited you to explore roles on Aura',
    undefined,
    undefined,
    {
      companyId,
      companyHandle: readString(params.companyHandle, 120),
      invitedByUserId: readString(params.invitedByUserId, 120) || undefined,
    },
    undefined,
    'user',
  );

  await recordOpenToWorkInviteMetric({
    db: params.db,
    userId: candidateUserId,
  });

  return notification;
};
