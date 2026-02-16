import { Router } from 'express';
import { getDB, isDBConnected } from '../db';
import { requireAuth } from '../middleware/authMiddleware';
import { sendReportPreviewEmail, isEmailDeliveryConfigured } from '../services/emailService';
import { resolveIdentityActor, validateIdentityAccess } from '../utils/identityUtils';

const router = Router();

type ReportFrequency = 'daily' | 'weekly' | 'monthly';
type ReportScope = 'company_signals' | 'specific_campaign' | 'all_signals';
type ReportDeliveryMode = 'inline_email' | 'pdf_attachment';
type WeekdayName = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';

interface ReportScheduleDoc {
  id: string;
  ownerId: string;
  ownerType: 'user' | 'company';
  createdByUserId: string;
  frequency: ReportFrequency;
  scope: ReportScope;
  recipients: string[];
  deliveryMode: ReportDeliveryMode;
  includeKPIs: boolean;
  includeTrends: boolean;
  includeTopPosts: boolean;
  includeEfficiency: boolean;
  weeklyDay: WeekdayName;
  monthlyDay: number;
  time: string;
  campaignName: string;
  timezone?: string;
  status: 'active' | 'paused';
  nextRunAt: number;
  lastRunAt?: number;
  lastRunStatus?: 'success' | 'failed';
  lastError?: string;
  processing?: boolean;
  createdAt: string;
  updatedAt: string;
}

const REPORT_SCHEDULES_COLLECTION = 'reportSchedules';
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REPORT_RUNNER_INTERVAL_MS = 60 * 1000;
const REPORT_RUNNER_BATCH_LIMIT = 20;
const WEEKDAY_TO_INDEX: Record<WeekdayName, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5
};

const toBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  return fallback;
};

const clampMonthlyDay = (value: unknown): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.min(28, Math.floor(num)));
};

const normalizeTime = (value: unknown): string => {
  if (typeof value !== 'string') return '08:00';
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return '08:00';
  const [hRaw, mRaw] = trimmed.split(':');
  const hours = Math.max(0, Math.min(23, Number(hRaw)));
  const minutes = Math.max(0, Math.min(59, Number(mRaw)));
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

const normalizeRecipients = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
        .filter((entry) => entry.length > 0)
        .filter((entry) => emailRegex.test(entry))
    )
  ).slice(0, 5);
};

const getOwnerFromRequest = async (req: any): Promise<{ ownerId: string; ownerType: 'user' | 'company' } | null> => {
  const actor = req?.user;
  if (!actor?.id) return null;

  const requestedOwnerType = typeof req.body?.ownerType === 'string'
    ? req.body.ownerType
    : (typeof req.query?.ownerType === 'string' ? req.query.ownerType : undefined);
  const requestedOwnerId = typeof req.body?.ownerId === 'string'
    ? req.body.ownerId
    : (typeof req.query?.ownerId === 'string' ? req.query.ownerId : undefined);

  const resolved = await resolveIdentityActor(
    actor.id,
    { ownerType: requestedOwnerType, ownerId: requestedOwnerId },
    req.headers
  );
  if (!resolved) return null;
  return { ownerId: resolved.id, ownerType: resolved.type };
};

const computeNextRunAt = (schedule: Pick<ReportScheduleDoc, 'frequency' | 'weeklyDay' | 'monthlyDay' | 'time'>, fromMs = Date.now()): number => {
  const [hourPart, minutePart] = normalizeTime(schedule.time).split(':');
  const targetHours = Number(hourPart);
  const targetMinutes = Number(minutePart);
  const now = new Date(fromMs);
  const candidate = new Date(fromMs);
  candidate.setSeconds(0, 0);
  candidate.setHours(targetHours, targetMinutes, 0, 0);

  if (schedule.frequency === 'daily') {
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime();
  }

  if (schedule.frequency === 'weekly') {
    const targetDay = WEEKDAY_TO_INDEX[schedule.weeklyDay] ?? now.getDay();
    let diff = targetDay - candidate.getDay();
    if (diff < 0 || (diff === 0 && candidate.getTime() <= now.getTime())) {
      diff += 7;
    }
    candidate.setDate(candidate.getDate() + diff);
    return candidate.getTime();
  }

  const monthlyDay = clampMonthlyDay(schedule.monthlyDay);
  candidate.setDate(monthlyDay);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setMonth(candidate.getMonth() + 1);
    candidate.setDate(monthlyDay);
  }
  return candidate.getTime();
};

const buildOwnerAnalyticsMatch = (ownerId: string, ownerType: 'user' | 'company') => {
  if (ownerType === 'company') {
    return {
      $or: [
        { ownerId, ownerType: 'company' },
        { userId: ownerId, ownerType: 'company' }
      ]
    };
  }

  return {
    $or: [
      { ownerId, ownerType: 'user' },
      { ownerId, ownerType: { $exists: false } },
      { userId: ownerId }
    ]
  };
};

const buildScheduledSummaryPayload = async (schedule: ReportScheduleDoc) => {
  const db = getDB();
  const match = buildOwnerAnalyticsMatch(schedule.ownerId, schedule.ownerType);
  const rows = await db.collection('adAnalytics')
    .find(match)
    .project({
      adId: 1,
      impressions: 1,
      clicks: 1,
      engagement: 1,
      reach: 1,
      spend: 1,
      conversions: 1
    })
    .sort({ clicks: -1, impressions: -1 })
    .limit(100)
    .toArray();

  const totals = rows.reduce(
    (acc: any, row: any) => {
      acc.impressions += Number(row?.impressions || 0);
      acc.clicks += Number(row?.clicks || 0);
      acc.reach += Number(row?.reach || 0);
      acc.spend += Number(row?.spend || 0);
      acc.conversions += Number(row?.conversions || 0);
      return acc;
    },
    { impressions: 0, clicks: 0, reach: 0, spend: 0, conversions: 0 }
  );

  const adIds = Array.from(new Set(rows.map((row: any) => row?.adId).filter((id): id is string => typeof id === 'string' && id.length > 0)));
  const ads = adIds.length
    ? await db.collection('ads').find({ id: { $in: adIds } }).project({ id: 1, headline: 1 }).toArray()
    : [];
  const adNameMap = new Map<string, string>(ads.map((ad: any) => [String(ad.id), String(ad.headline || 'Untitled Signal')]));

  const topSignals = rows.slice(0, 5).map((row: any) => {
    const impressions = Number(row?.impressions || 0);
    const clicks = Number(row?.clicks || 0);
    return {
      name: adNameMap.get(String(row?.adId || '')) || String(row?.adId || 'Untitled Signal'),
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      reach: Number(row?.reach || 0)
    };
  });

  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const auraEfficiency = totals.spend > 0
    ? ((totals.clicks + totals.conversions * 2) / totals.spend)
    : 0;

  const recommendations: string[] = [];
  if (ctr < 1.5) {
    recommendations.push('Refresh creative and CTA on your lowest-performing signals.');
  } else {
    recommendations.push('Scale spend behind top-performing creative in the next cycle.');
  }
  if (totals.conversions < Math.max(1, totals.clicks * 0.02)) {
    recommendations.push('Improve landing-page relevance to increase conversion quality.');
  } else {
    recommendations.push('Replicate winning conversion paths to adjacent audience segments.');
  }
  if (topSignals[0]?.name) {
    recommendations.push(`Prioritize budget behind "${topSignals[0].name}" until next report cycle.`);
  } else {
    recommendations.push('Launch one additional signal to improve trend and optimization depth.');
  }

  return {
    periodLabel: schedule.frequency === 'daily'
      ? 'Last 24 hours'
      : schedule.frequency === 'weekly'
        ? 'Last 7 days'
        : 'Last 30 days',
    scope: schedule.scope,
    campaignName: schedule.campaignName,
    metrics: {
      reach: totals.reach,
      ctr,
      clicks: totals.clicks,
      conversions: totals.conversions,
      spend: totals.spend,
      auraEfficiency
    },
    topSignals,
    recommendations
  };
};

const mapScheduleToResponse = (doc: ReportScheduleDoc) => ({
  id: doc.id,
  frequency: doc.frequency,
  scope: doc.scope,
  recipients: doc.recipients,
  deliveryEmail: doc.recipients.length > 0,
  deliveryPdf: doc.deliveryMode === 'pdf_attachment',
  deliveryMode: doc.deliveryMode,
  includeKPIs: doc.includeKPIs,
  includeTrends: doc.includeTrends,
  includeTopPosts: doc.includeTopPosts,
  includeEfficiency: doc.includeEfficiency,
  weeklyDay: doc.weeklyDay,
  monthlyDay: doc.monthlyDay,
  time: doc.time,
  campaignName: doc.campaignName,
  status: doc.status,
  nextRunAt: doc.nextRunAt,
  lastRunAt: doc.lastRunAt,
  lastRunStatus: doc.lastRunStatus,
  lastError: doc.lastError
});

export const processDueReportSchedules = async () => {
  if (!isDBConnected()) return;
  if (!isEmailDeliveryConfigured()) return;

  const db = getDB();
  const now = Date.now();
  const dueSchedules = await db.collection(REPORT_SCHEDULES_COLLECTION)
    .find({
      status: 'active',
      nextRunAt: { $lte: now },
      processing: { $ne: true }
    })
    .sort({ nextRunAt: 1 })
    .limit(REPORT_RUNNER_BATCH_LIMIT)
    .toArray() as unknown as ReportScheduleDoc[];

  for (const schedule of dueSchedules) {
    const lockResult = await db.collection(REPORT_SCHEDULES_COLLECTION).updateOne(
      { id: schedule.id, status: 'active', nextRunAt: schedule.nextRunAt, processing: { $ne: true } },
      { $set: { processing: true, updatedAt: new Date().toISOString() } }
    );
    if (lockResult.modifiedCount === 0) continue;

    try {
      const payload = await buildScheduledSummaryPayload(schedule);
      const results = await Promise.all(schedule.recipients.map((recipient) => sendReportPreviewEmail(recipient, payload)));
      const deliveredCount = results.filter((result) => result.delivered).length;
      const nextRunAt = computeNextRunAt(schedule, Date.now() + 30_000);

      await db.collection(REPORT_SCHEDULES_COLLECTION).updateOne(
        { id: schedule.id },
        {
          $set: {
            processing: false,
            lastRunAt: Date.now(),
            lastRunStatus: deliveredCount > 0 ? 'success' : 'failed',
            lastError: deliveredCount > 0 ? null : 'Email delivery unavailable',
            nextRunAt,
            updatedAt: new Date().toISOString()
          }
        }
      );
    } catch (error: any) {
      await db.collection(REPORT_SCHEDULES_COLLECTION).updateOne(
        { id: schedule.id },
        {
          $set: {
            processing: false,
            lastRunAt: Date.now(),
            lastRunStatus: 'failed',
            lastError: error?.message || 'Failed to send scheduled report',
            nextRunAt: Date.now() + 15 * 60 * 1000,
            updatedAt: new Date().toISOString()
          }
        }
      );
    }
  }
};

let reportSchedulerTimer: NodeJS.Timeout | null = null;

export const startReportScheduleWorker = () => {
  if (reportSchedulerTimer) return;
  reportSchedulerTimer = setInterval(() => {
    processDueReportSchedules().catch((error) => {
      console.error('Scheduled report worker failed:', error);
    });
  }, REPORT_RUNNER_INTERVAL_MS);

  // Warmup run after startup.
  setTimeout(() => {
    processDueReportSchedules().catch((error) => {
      console.error('Scheduled report warmup run failed:', error);
    });
  }, 10000);
};

router.post('/preview-email', requireAuth, async (req, res) => {
  try {
    const actor = (req as any).user;
    if (!actor?.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (!isEmailDeliveryConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Email delivery is not configured. Add SENDGRID_API_KEY and sender settings on the backend.'
      });
    }

    const recipients = normalizeRecipients(req.body?.recipients);
    if (recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one valid recipient is required' });
    }

    const summary = typeof req.body?.summary === 'object' && req.body?.summary ? req.body.summary : {};
    const deliveryMode = req.body?.deliveryMode === 'pdf_attachment' ? 'pdf_attachment' : 'inline_email';

    let pdfAttachment: { filename?: string; contentBase64?: string } | undefined;
    const rawAttachment = req.body?.pdfAttachment;
    if (rawAttachment && typeof rawAttachment === 'object') {
      const filename = typeof rawAttachment.filename === 'string' ? rawAttachment.filename.trim() : '';
      const contentBase64 = typeof rawAttachment.contentBase64 === 'string' ? rawAttachment.contentBase64.trim() : '';
      if (contentBase64.length > 0) {
        const normalizedBase64 = contentBase64.replace(/^data:application\/pdf;base64,/, '');
        if (normalizedBase64.length > 8_000_000) {
          return res.status(400).json({ success: false, error: 'PDF attachment is too large' });
        }
        pdfAttachment = {
          filename: filename || 'aura-scheduled-report.pdf',
          contentBase64: normalizedBase64
        };
      }
    }

    const payload = {
      ...summary,
      deliveryMode,
      ...(pdfAttachment ? { pdfAttachment } : {})
    };

    const results = await Promise.all(recipients.map((recipient) => sendReportPreviewEmail(recipient, payload)));
    const sentTo = results.filter((result) => result.delivered).length;

    if (sentTo === 0) {
      return res.status(503).json({
        success: false,
        error: results[0]?.reason || 'No report emails were delivered'
      });
    }

    return res.json({
      success: true,
      sentTo
    });
  } catch (error: any) {
    console.error('Error sending report preview email:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send report preview email'
    });
  }
});

router.get('/schedules', requireAuth, async (req, res) => {
  try {
    const actor = (req as any).user;
    if (!actor?.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const owner = await getOwnerFromRequest(req);
    if (!owner) {
      return res.status(403).json({ success: false, error: 'Unauthorized identity context' });
    }

    const db = getDB();
    const docs = await db.collection(REPORT_SCHEDULES_COLLECTION)
      .find({ ownerId: owner.ownerId, ownerType: owner.ownerType, status: { $ne: 'paused' } })
      .sort({ createdAt: -1 })
      .toArray() as unknown as ReportScheduleDoc[];

    return res.json({
      success: true,
      data: docs.map(mapScheduleToResponse)
    });
  } catch (error) {
    console.error('Error listing report schedules:', error);
    return res.status(500).json({ success: false, error: 'Failed to load report schedules' });
  }
});

router.post('/schedules', requireAuth, async (req, res) => {
  try {
    const actor = (req as any).user;
    if (!actor?.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const owner = await getOwnerFromRequest(req);
    if (!owner) {
      return res.status(403).json({ success: false, error: 'Unauthorized identity context' });
    }

    const recipients = normalizeRecipients(req.body?.recipients);
    if (recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one valid recipient is required' });
    }
    if (!isEmailDeliveryConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Email delivery is not configured. Add SENDGRID_API_KEY and sender settings on the backend.'
      });
    }

    const frequency: ReportFrequency = req.body?.frequency === 'daily' || req.body?.frequency === 'weekly' || req.body?.frequency === 'monthly'
      ? req.body.frequency
      : 'weekly';
    const scope: ReportScope = req.body?.scope === 'company_signals' || req.body?.scope === 'specific_campaign' || req.body?.scope === 'all_signals'
      ? req.body.scope
      : 'all_signals';
    const deliveryMode: ReportDeliveryMode = req.body?.deliveryMode === 'pdf_attachment' ? 'pdf_attachment' : 'inline_email';
    const weeklyDay: WeekdayName = req.body?.weeklyDay && WEEKDAY_TO_INDEX[req.body.weeklyDay as WeekdayName]
      ? req.body.weeklyDay as WeekdayName
      : 'Monday';
    const monthlyDay = clampMonthlyDay(req.body?.monthlyDay);
    const time = normalizeTime(req.body?.time);
    const campaignName = typeof req.body?.campaignName === 'string' ? req.body.campaignName.trim().slice(0, 120) : '';
    const nowIso = new Date().toISOString();

    const schedule: ReportScheduleDoc = {
      id: `report-schedule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      ownerId: owner.ownerId,
      ownerType: owner.ownerType,
      createdByUserId: actor.id,
      frequency,
      scope,
      recipients,
      deliveryMode,
      includeKPIs: toBoolean(req.body?.includeKPIs, true),
      includeTrends: toBoolean(req.body?.includeTrends, true),
      includeTopPosts: toBoolean(req.body?.includeTopPosts, true),
      includeEfficiency: toBoolean(req.body?.includeEfficiency, true),
      weeklyDay,
      monthlyDay,
      time,
      campaignName,
      timezone: typeof req.body?.timezone === 'string' ? req.body.timezone.trim().slice(0, 80) : undefined,
      status: 'active',
      nextRunAt: computeNextRunAt({ frequency, weeklyDay, monthlyDay, time }),
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const db = getDB();
    const existingCount = await db.collection(REPORT_SCHEDULES_COLLECTION).countDocuments({
      ownerId: owner.ownerId,
      ownerType: owner.ownerType,
      status: 'active'
    });
    if (existingCount >= 20) {
      return res.status(400).json({ success: false, error: 'Maximum of 20 active schedules reached' });
    }

    await db.collection(REPORT_SCHEDULES_COLLECTION).insertOne(schedule);

    return res.status(201).json({
      success: true,
      data: mapScheduleToResponse(schedule)
    });
  } catch (error) {
    console.error('Error creating report schedule:', error);
    return res.status(500).json({ success: false, error: 'Failed to create report schedule' });
  }
});

router.delete('/schedules/:id', requireAuth, async (req, res) => {
  try {
    const actor = (req as any).user;
    const scheduleId = req.params.id;
    if (!actor?.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (!scheduleId) {
      return res.status(400).json({ success: false, error: 'Schedule id is required' });
    }

    const db = getDB();
    const schedule = await db.collection(REPORT_SCHEDULES_COLLECTION).findOne({ id: scheduleId }) as ReportScheduleDoc | null;
    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Schedule not found' });
    }

    if (schedule.ownerType === 'user') {
      if (schedule.ownerId !== actor.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }
    } else {
      const hasAccess = await validateIdentityAccess(actor.id, schedule.ownerId);
      if (!hasAccess) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }
    }

    await db.collection(REPORT_SCHEDULES_COLLECTION).deleteOne({ id: scheduleId });
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting report schedule:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete report schedule' });
  }
});

export default router;
