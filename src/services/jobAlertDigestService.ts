import { isEmailDeliveryConfigured } from './emailService';
import { sendWeeklyPublicJobAlertDigests } from './publicJobAlertDigestService';
import { sendEveryOtherDayUserJobAlertDigests } from './userJobAlertDigestService';

export const sendScheduledJobAlertDigests = async (db: any): Promise<void> => {
  if (!db) return;
  if (!isEmailDeliveryConfigured()) {
    console.warn('⚠️ Skipping scheduled job alert digests because SendGrid is not configured.');
    return;
  }

  await sendEveryOtherDayUserJobAlertDigests(db);
  await sendWeeklyPublicJobAlertDigests(db);
};
