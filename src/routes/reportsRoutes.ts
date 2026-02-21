import { Router } from 'express';
import { getDB, isDBConnected } from '../db';
import { requireAuth } from '../middleware/authMiddleware';
import { sendReportPreviewEmail, isEmailDeliveryConfigured } from '../services/emailService';
import { resolveIdentityActor, validateIdentityAccess } from '../utils/identityUtils';
import { AdPlanEntitlements, AdPlanId } from '../constants/adPlans';
import { resolveOwnerPlanAccess } from '../utils/adPlanAccess';
import rateLimit from 'express-rate-limit';

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
const REPORT_PREVIEW_AUDIT_COLLECTION = 'reportPreviewAudit';
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REPORT_RUNNER_INTERVAL_MS = 60 * 1000;
const REPORT_RUNNER_BATCH_LIMIT = 20;
const REPORT_PREVIEW_DAILY_LIMIT = 30;
const REPORT_CAMPAIGN_DATA_MAX_ROWS = 10000;
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

const resolveOwnerReportEntitlements = async (
  owner: { ownerId: string; ownerType: 'user' | 'company' }
): Promise<{ packageId: AdPlanId; entitlements: AdPlanEntitlements }> => {
  const db = getDB();
  const planAccess = await resolveOwnerPlanAccess(db, owner.ownerId, owner.ownerType, Date.now());
  return { packageId: planAccess.packageId, entitlements: planAccess.entitlements };
};

const normalizeEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || !emailRegex.test(normalized)) return null;
  return normalized;
};

const collectAllowedPreviewRecipients = async (
  owner: { ownerId: string; ownerType: 'user' | 'company' },
  actorId: string
): Promise<Set<string>> => {
  const db = getDB();
  const allowed = new Set<string>();

  const pushEmail = (value: unknown) => {
    const normalized = normalizeEmail(value);
    if (normalized) {
      allowed.add(normalized);
    }
  };

  const actor = await db.collection('users').findOne(
    { id: actorId },
    { projection: { email: 1 } }
  );
  pushEmail(actor?.email);

  if (owner.ownerType === 'user') {
    if (owner.ownerId !== actorId) {
      const ownerUser = await db.collection('users').findOne(
        { id: owner.ownerId },
        { projection: { email: 1 } }
      );
      pushEmail(ownerUser?.email);
    }
    return allowed;
  }

  const [company, memberships] = await Promise.all([
    db.collection('companies').findOne(
      { id: owner.ownerId, legacyArchived: { $ne: true } },
      { projection: { email: 1 } }
    ),
    db.collection('company_members')
      .find({ companyId: owner.ownerId }, { projection: { userId: 1 } })
      .toArray()
  ]);

  pushEmail(company?.email);

  const memberIds = Array.from(new Set(
    memberships
      .map((membership: any) => (typeof membership?.userId === 'string' ? membership.userId : ''))
      .filter((memberId: string) => memberId.length > 0)
  ));

  if (memberIds.length > 0) {
    const members = await db.collection('users')
      .find({ id: { $in: memberIds } }, { projection: { email: 1 } })
      .toArray();
    for (const member of members) {
      pushEmail((member as any)?.email);
    }
  }

  return allowed;
};

const reportPreviewRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many report preview requests',
    message: 'Please wait before sending another report preview.'
  }
});

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

type CampaignMeta = { name: string; status: string; lastUpdated?: number };
type CampaignDataRow = {
  id: string;
  name: string;
  status: string;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  conversions: number;
  lastUpdated: number;
};
type AnalyticsTotals = {
  impressions: number;
  clicks: number;
  engagement: number;
  reach: number;
  conversions: number;
};

const aggregateAnalyticsTotals = (rows: any[]): AnalyticsTotals => rows.reduce(
  (acc: AnalyticsTotals, row: any) => {
    acc.impressions += Number(row?.impressions || 0);
    acc.clicks += Number(row?.clicks || 0);
    acc.engagement += Number(row?.engagement || 0);
    acc.reach += Number(row?.reach || 0);
    acc.conversions += Number(row?.conversions || 0);
    return acc;
  },
  { impressions: 0, clicks: 0, engagement: 0, reach: 0, conversions: 0 }
);

const mapCampaignDataRows = (rows: any[], adMetaMap: Map<string, CampaignMeta>): CampaignDataRow[] => rows.map((row: any) => {
  const impressions = Number(row?.impressions || 0);
  const clicks = Number(row?.clicks || 0);
  const adMeta = adMetaMap.get(String(row?.adId || ''));
  return {
    id: String(row?.adId || ''),
    name: adMeta?.name || String(row?.adId || 'Untitled Signal'),
    status: adMeta?.status || 'active',
    impressions,
    reach: Number(row?.reach || 0),
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    conversions: Number(row?.conversions || 0),
    lastUpdated: adMeta?.lastUpdated || Date.now()
  };
});

const buildTopSignals = (campaignData: CampaignDataRow[]) => campaignData.slice(0, 5).map((row) => ({
  name: row.name,
  ctr: row.ctr,
  reach: row.reach
}));

const buildRecommendations = (
  ctr: number,
  totals: AnalyticsTotals,
  topSignals: Array<{ name: string; ctr: number; reach: number }>
) => {
  const recommendations: string[] = [];
  if (ctr < 1.5) {
    recommendations.push('Refresh creative and CTA on your lowest-performing signals.');
  } else {
    recommendations.push('Scale distribution behind top-performing creative in the next cycle.');
  }
  if (totals.conversions < Math.max(1, totals.clicks * 0.02)) {
    recommendations.push('Improve landing-page relevance to increase conversion quality.');
  } else {
    recommendations.push('Replicate winning conversion paths to adjacent audience segments.');
  }
  if (topSignals[0]?.name) {
    recommendations.push(`Prioritize delivery behind "${topSignals[0].name}" until next report cycle.`);
  } else {
    recommendations.push('Launch one additional signal to improve trend and optimization depth.');
  }
  return recommendations;
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
      conversions: 1
    })
    .sort({ impressions: -1, clicks: -1 })
    .limit(REPORT_CAMPAIGN_DATA_MAX_ROWS)
    .toArray();

  const totals = aggregateAnalyticsTotals(rows);

  const adIds = Array.from(new Set(rows.map((row: any) => row?.adId).filter((id): id is string => typeof id === 'string' && id.length > 0)));
  const ads = adIds.length
    ? await db.collection('ads').find({ id: { $in: adIds } }).project({ id: 1, headline: 1, status: 1, lastUpdated: 1 }).toArray()
    : [];
  const adMetaMap = new Map<string, CampaignMeta>(
    ads.map((ad: any) => [
      String(ad.id),
      {
        name: String(ad.headline || 'Untitled Signal'),
        status: String(ad.status || 'active'),
        lastUpdated: Number(ad.lastUpdated || 0) || undefined
      }
    ])
  );

  const campaignData = mapCampaignDataRows(rows, adMetaMap);
  const topSignals = buildTopSignals(campaignData);

  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const conversionRate = totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0;
  const auraEfficiency = Number(((ctr * 0.65) + (conversionRate * 0.35)).toFixed(2));
  const recommendations = buildRecommendations(ctr, totals, topSignals);

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
      auraEfficiency
    },
    campaignData,
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
      const planAccess = await resolveOwnerReportEntitlements({
        ownerId: schedule.ownerId,
        ownerType: schedule.ownerType
      });
      if (!planAccess.entitlements.canScheduleReports) {
        await db.collection(REPORT_SCHEDULES_COLLECTION).updateOne(
          { id: schedule.id },
          {
            $set: {
              processing: false,
              status: 'paused',
              lastRunAt: Date.now(),
              lastRunStatus: 'failed',
              lastError: 'Paused automatically because scheduled reports are not available for the current plan.',
              updatedAt: new Date().toISOString()
            }
          }
        );
        continue;
      }

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

router.post('/preview-email', requireAuth, reportPreviewRateLimiter, async (req, res) => {
  try {
    const actor = (req as any).user;
    if (!actor?.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const owner = await getOwnerFromRequest(req);
    if (!owner) {
      return res.status(403).json({ success: false, error: 'Unauthorized identity context' });
    }
    const planAccess = await resolveOwnerReportEntitlements(owner);
    if (!planAccess.entitlements.canScheduleReports) {
      return res.status(403).json({
        success: false,
        error: 'Report scheduling is not available for this plan',
        message: 'Scheduled report delivery is available on Universal Signal.'
      });
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
    const db = getDB();
    const nowMs = Date.now();
    const last24h = nowMs - 24 * 60 * 60 * 1000;
    const sentInLast24h = await db.collection(REPORT_PREVIEW_AUDIT_COLLECTION).countDocuments({
      ownerId: owner.ownerId,
      ownerType: owner.ownerType,
      createdAtMs: { $gte: last24h }
    });

    if (sentInLast24h >= REPORT_PREVIEW_DAILY_LIMIT) {
      return res.status(429).json({
        success: false,
        error: 'Daily report preview limit reached',
        message: 'Report preview quota exceeded for the last 24 hours.'
      });
    }

    const allowedRecipients = await collectAllowedPreviewRecipients(owner, actor.id);
    const forbiddenRecipients = recipients.filter((recipient) => !allowedRecipients.has(recipient));
    if (forbiddenRecipients.length > 0) {
      return res.status(403).json({
        success: false,
        error: 'Recipient not allowed',
        message: 'Report previews can only be sent to verified owner/team email recipients.',
        recipients: forbiddenRecipients
      });
    }

    const summary = typeof req.body?.summary === 'object' && req.body?.summary ? req.body.summary : {};
    const deliveryMode = req.body?.deliveryMode === 'pdf_attachment' ? 'pdf_attachment' : 'inline_email';
    if (deliveryMode === 'pdf_attachment' && !planAccess.entitlements.canExportPdf) {
      return res.status(403).json({
        success: false,
        error: 'PDF report delivery is not available for this plan'
      });
    }

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

    await db.collection(REPORT_PREVIEW_AUDIT_COLLECTION).insertOne({
      id: `report-preview-${nowMs}-${Math.random().toString(36).slice(2, 9)}`,
      ownerId: owner.ownerId,
      ownerType: owner.ownerType,
      requestedByUserId: actor.id,
      recipients,
      sentTo,
      createdAtMs: nowMs,
      createdAt: new Date(nowMs).toISOString()
    });

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
    const planAccess = await resolveOwnerReportEntitlements(owner);
    if (!planAccess.entitlements.canScheduleReports) {
      return res.json({
        success: true,
        data: []
      });
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
    const planAccess = await resolveOwnerReportEntitlements(owner);
    if (!planAccess.entitlements.canScheduleReports) {
      return res.status(403).json({
        success: false,
        error: 'Report scheduling is not available for this plan',
        message: 'Scheduled reports are available on Universal Signal.'
      });
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
    if (deliveryMode === 'pdf_attachment' && !planAccess.entitlements.canExportPdf) {
      return res.status(403).json({
        success: false,
        error: 'PDF report delivery is not available for this plan'
      });
    }
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
