import { Request, Response } from 'express';
import { getDB } from '../db';
import { getHashtagsFromText, filterByHashtags } from '../utils/hashtagUtils';
import { resolveIdentityActor } from '../utils/identityUtils';
import { AD_PLANS } from '../constants/adPlans';
import { ensureCurrentPeriod } from './adSubscriptionsController';
import crypto from 'crypto';

type AdCampaignWhy =
  | 'safe_clicks_conversions'
  | 'lead_capture_no_exit'
  | 'email_growth'
  | 'book_more_calls'
  | 'gate_high_intent_downloads';

type AdLeadCaptureType =
  | 'none'
  | 'get_quote'
  | 'request_demo'
  | 'email_capture'
  | 'calendar_booking'
  | 'download_gate';

type SanitizedLeadCaptureConfig = {
  type: AdLeadCaptureType;
  title?: string;
  description?: string;
  submitLabel?: string;
  successMessage?: string;
  includeName?: boolean;
  includeEmail?: boolean;
  includePhone?: boolean;
  includeMessage?: boolean;
  calendarUrl?: string;
  downloadUrl?: string;
  downloadLabel?: string;
};

type SanitizedLeadSubmission = {
  type: Exclude<AdLeadCaptureType, 'none'>;
  email: string;
  name?: string;
  phone?: string;
  message?: string;
};

const AD_UPDATE_ALLOWLIST = new Set<string>([
  'headline',
  'description',
  'mediaUrl',
  'mediaType',
  'ctaText',
  'ctaLink',
  'ctaPositionX',
  'ctaPositionY',
  'campaignWhy',
  'leadCapture',
  'placement',
  'expiryDate'
]);

const AD_ALLOWED_PLACEMENTS = new Set<string>(['feed', 'left', 'right', 'sidebar', 'story', 'search']);
const AD_ALLOWED_CAMPAIGN_WHY = new Set<AdCampaignWhy>([
  'safe_clicks_conversions',
  'lead_capture_no_exit',
  'email_growth',
  'book_more_calls',
  'gate_high_intent_downloads'
]);
const AD_ALLOWED_LEAD_CAPTURE_TYPES = new Set<AdLeadCaptureType>([
  'none',
  'get_quote',
  'request_demo',
  'email_capture',
  'calendar_booking',
  'download_gate'
]);
const AD_LEAD_EMAIL_REQUIRED_TYPES = new Set<Exclude<AdLeadCaptureType, 'none'>>([
  'get_quote',
  'request_demo',
  'email_capture',
  'calendar_booking',
  'download_gate'
]);
const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const trimOptionalText = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeActionUrl = (value: unknown, maxLength: number): string | undefined => {
  const raw = trimOptionalText(value, maxLength);
  if (!raw) return undefined;
  if (
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('mailto:') ||
    raw.startsWith('tel:') ||
    raw.startsWith('/')
  ) {
    return raw;
  }
  return `https://${raw}`;
};

const sanitizeLeadCaptureConfig = (incoming: unknown): SanitizedLeadCaptureConfig | undefined => {
  if (!incoming || typeof incoming !== 'object') return undefined;

  const candidate = incoming as Record<string, unknown>;
  const rawType = typeof candidate.type === 'string' ? candidate.type.trim().toLowerCase() : 'none';
  const type: AdLeadCaptureType = AD_ALLOWED_LEAD_CAPTURE_TYPES.has(rawType as AdLeadCaptureType)
    ? (rawType as AdLeadCaptureType)
    : 'none';

  const title = trimOptionalText(candidate.title, 120);
  const description = trimOptionalText(candidate.description, 500);
  const submitLabel = trimOptionalText(candidate.submitLabel, 60);
  const successMessage = trimOptionalText(candidate.successMessage, 240);
  const downloadLabel = trimOptionalText(candidate.downloadLabel, 80);
  const calendarUrl = normalizeActionUrl(candidate.calendarUrl, 500);
  const downloadUrl = normalizeActionUrl(candidate.downloadUrl, 500);

  const includeName = typeof candidate.includeName === 'boolean' ? candidate.includeName : undefined;
  const includeEmail = typeof candidate.includeEmail === 'boolean' ? candidate.includeEmail : undefined;
  const includePhone = typeof candidate.includePhone === 'boolean' ? candidate.includePhone : undefined;
  const includeMessage = typeof candidate.includeMessage === 'boolean' ? candidate.includeMessage : undefined;

  const sanitized: SanitizedLeadCaptureConfig = { type };
  if (title) sanitized.title = title;
  if (description) sanitized.description = description;
  if (submitLabel) sanitized.submitLabel = submitLabel;
  if (successMessage) sanitized.successMessage = successMessage;
  if (downloadLabel) sanitized.downloadLabel = downloadLabel;
  if (calendarUrl) sanitized.calendarUrl = calendarUrl;
  if (downloadUrl) sanitized.downloadUrl = downloadUrl;
  if (typeof includeName === 'boolean') sanitized.includeName = includeName;
  if (typeof includeEmail === 'boolean') sanitized.includeEmail = includeEmail;
  if (typeof includePhone === 'boolean') sanitized.includePhone = includePhone;
  if (typeof includeMessage === 'boolean') sanitized.includeMessage = includeMessage;

  return sanitized;
};

const sanitizeLeadSubmissionPayload = (
  incoming: unknown,
  fallbackType: AdLeadCaptureType
): { data?: SanitizedLeadSubmission; error?: string } => {
  const candidate = incoming && typeof incoming === 'object'
    ? (incoming as Record<string, unknown>)
    : {};

  const rawType = typeof candidate.type === 'string' ? candidate.type.trim().toLowerCase() : fallbackType;
  const resolvedType = AD_ALLOWED_LEAD_CAPTURE_TYPES.has(rawType as AdLeadCaptureType)
    ? (rawType as AdLeadCaptureType)
    : fallbackType;

  if (resolvedType === 'none') {
    return { error: 'Lead capture is not configured for this ad.' };
  }

  const email = trimOptionalText(candidate.email, 200)?.toLowerCase();
  if (AD_LEAD_EMAIL_REQUIRED_TYPES.has(resolvedType) && (!email || !SIMPLE_EMAIL_REGEX.test(email))) {
    return { error: 'A valid email is required.' };
  }

  const name = trimOptionalText(candidate.name, 120);
  const phone = trimOptionalText(candidate.phone, 64);
  const message = trimOptionalText(candidate.message, 1200);

  const sanitized: SanitizedLeadSubmission = {
    type: resolvedType,
    email: email as string
  };
  if (name) sanitized.name = name;
  if (phone) sanitized.phone = phone;
  if (message) sanitized.message = message;

  return { data: sanitized };
};

const sanitizeAdUpdates = (incoming: unknown): Record<string, unknown> => {
  if (!incoming || typeof incoming !== 'object') return {};
  const candidate = incoming as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(candidate)) {
    if (!AD_UPDATE_ALLOWLIST.has(key)) continue;
    sanitized[key] = value;
  }

  if (typeof sanitized.headline === 'string') {
    sanitized.headline = sanitized.headline.trim().slice(0, 180);
  } else {
    delete sanitized.headline;
  }

  if (typeof sanitized.description === 'string') {
    sanitized.description = sanitized.description.trim().slice(0, 3000);
  } else {
    delete sanitized.description;
  }

  if (typeof sanitized.mediaUrl === 'string') {
    sanitized.mediaUrl = sanitized.mediaUrl.trim();
  } else {
    delete sanitized.mediaUrl;
  }

  if (typeof sanitized.mediaType === 'string') {
    const mediaType = sanitized.mediaType.trim().toLowerCase();
    if (mediaType === 'image' || mediaType === 'video') {
      sanitized.mediaType = mediaType;
    } else {
      delete sanitized.mediaType;
    }
  } else {
    delete sanitized.mediaType;
  }

  if (typeof sanitized.ctaText === 'string') {
    sanitized.ctaText = sanitized.ctaText.trim().slice(0, 80);
  } else {
    delete sanitized.ctaText;
  }

  if (typeof sanitized.ctaLink === 'string') {
    sanitized.ctaLink = sanitized.ctaLink.trim().slice(0, 500);
  } else {
    delete sanitized.ctaLink;
  }

  if (sanitized.ctaPositionX !== undefined) {
    const x = Number(sanitized.ctaPositionX);
    if (Number.isFinite(x)) {
      sanitized.ctaPositionX = Math.max(0, Math.min(100, x));
    } else {
      delete sanitized.ctaPositionX;
    }
  }

  if (sanitized.ctaPositionY !== undefined) {
    const y = Number(sanitized.ctaPositionY);
    if (Number.isFinite(y)) {
      sanitized.ctaPositionY = Math.max(0, Math.min(100, y));
    } else {
      delete sanitized.ctaPositionY;
    }
  }

  if (typeof sanitized.campaignWhy === 'string') {
    const campaignWhy = sanitized.campaignWhy.trim().toLowerCase() as AdCampaignWhy;
    if (AD_ALLOWED_CAMPAIGN_WHY.has(campaignWhy)) {
      sanitized.campaignWhy = campaignWhy;
    } else {
      delete sanitized.campaignWhy;
    }
  } else {
    delete sanitized.campaignWhy;
  }

  if (sanitized.leadCapture !== undefined) {
    const leadCapture = sanitizeLeadCaptureConfig(sanitized.leadCapture);
    if (leadCapture) {
      sanitized.leadCapture = leadCapture;
    } else {
      delete sanitized.leadCapture;
    }
  }

  if (typeof sanitized.placement === 'string') {
    const placement = sanitized.placement.trim().toLowerCase();
    if (AD_ALLOWED_PLACEMENTS.has(placement)) {
      sanitized.placement = placement;
    } else {
      delete sanitized.placement;
    }
  } else {
    delete sanitized.placement;
  }

  if (sanitized.expiryDate !== undefined) {
    const parsedExpiry = Number(sanitized.expiryDate);
    if (Number.isFinite(parsedExpiry) && parsedExpiry > 0) {
      sanitized.expiryDate = parsedExpiry;
    } else {
      delete sanitized.expiryDate;
    }
  }

  return sanitized;
};

const sanitizeAdCreatePayload = (incoming: unknown): Record<string, unknown> => {
  const sanitized = sanitizeAdUpdates(incoming);

  if (!sanitized.headline || typeof sanitized.headline !== 'string') {
    return {};
  }

  if (!sanitized.description || typeof sanitized.description !== 'string') {
    return {};
  }

  if (typeof sanitized.mediaUrl !== 'string') {
    delete sanitized.mediaUrl;
  }
  if (typeof sanitized.mediaType !== 'string') {
    delete sanitized.mediaType;
  }
  if (typeof sanitized.ctaText !== 'string') {
    sanitized.ctaText = 'Learn More';
  }
  if (typeof sanitized.ctaLink !== 'string') {
    sanitized.ctaLink = '';
  }
  if (typeof sanitized.ctaPositionX !== 'number') {
    sanitized.ctaPositionX = 50;
  }
  if (typeof sanitized.ctaPositionY !== 'number') {
    sanitized.ctaPositionY = 84;
  }
  if (typeof sanitized.placement !== 'string') {
    sanitized.placement = 'feed';
  }
  if (typeof sanitized.campaignWhy !== 'string') {
    sanitized.campaignWhy = 'safe_clicks_conversions';
  }
  if (!sanitized.leadCapture || typeof sanitized.leadCapture !== 'object') {
    sanitized.leadCapture = { type: 'none' as AdLeadCaptureType };
  }

  return sanitized;
};

function dateKeyUTC(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD
}

function fingerprint(req: Request) {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
  const ua = String(req.headers['user-agent'] || '');
  return crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex');
}

export const emitAdAnalyticsUpdate = async (app: any, adId: string, ownerId: string, ownerType: 'user' | 'company' = 'user') => {
  try {
    if (!adId || !ownerId) return;
    const io = app?.get && app.get('io');
    if (!io || typeof io.to !== 'function') {
      console.warn('⚠️ Cannot emit ad analytics update: Socket.IO (io) not found on app');
      return;
    }

    const db = getDB();
    const analytics = await db.collection('adAnalytics').findOne({ adId });
    if (!analytics) return;

    console.log(`📡 Emitting live ad analytics update to ${ownerType}: ${ownerId}`);
    
    const payload: any = {
      stats: {
        adMetrics: {
          adId: analytics.adId,
          impressions: analytics.impressions || 0,
          clicks: analytics.clicks || 0,
          ctr: analytics.ctr || 0,
          reach: analytics.reach || 0,
          engagement: analytics.engagement || 0,
          conversions: analytics.conversions || 0,
          spend: analytics.spend || 0,
          lastUpdated: analytics.lastUpdated || Date.now()
        }
      }
    };

    if (ownerType === 'company') {
      payload.companyId = ownerId;
      io.to(`company_${ownerId}`).emit('analytics_update', payload);
    } else {
      payload.userId = ownerId;
      io.to(ownerId).emit('analytics_update', payload);
    }
  } catch (err) {
    console.error('emitAdAnalyticsUpdate error', err);
  }
};


export const adsController = {
  // GET /api/ads/me - Get ads for the current user
  getMyAds: async (req: Request, res: Response) => {
    try {
      const db = getDB();
      const currentUser = (req as any).user;
      if (!currentUser?.id) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const ownerType = (req.query.ownerType as string) || 'user';
      const ownerId = (req.query.ownerId as string) || currentUser.id;

      // Resolve effective actor identity
      const actor = await resolveIdentityActor(currentUser.id, { ownerType, ownerId });

      if (!actor) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'You do not have permission to view ads for this identity.'
        });
      }

      const effectiveOwnerId = actor.id;
      const effectiveOwnerType = actor.type;

      const limit = Math.min(Number(req.query.limit || 50), 200);
      const skip = Math.max(Number(req.query.skip || 0), 0);

      const ads = await db.collection('ads')
        .find({ ownerId: effectiveOwnerId, ownerType: effectiveOwnerType })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      res.json({ success: true, data: ads });
    } catch (e) {
      console.error('getMyAds error', e);
      res.status(500).json({ success: false, error: 'Failed to load ads' });
    }
  },

  // GET /api/ads - Get all ads
  getAllAds: async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 10, placement, status, hashtags, ownerType } = req.query;
      let { ownerId } = req.query;
      
      const currentUser = (req as any).user;
      const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);

      // Security hardening: Only admins can filter by arbitrary ownerId
      if (ownerId && !isAdmin) {
        // Use resolveIdentityActor to check access
        const actor = await resolveIdentityActor(currentUser.id, { 
          ownerType: ownerType as string, 
          ownerId: ownerId as string 
        });
        
        if (!actor) {
          ownerId = undefined;
        } else {
          ownerId = actor.id;
        }
      }

      const currentUserId = currentUser?.id;
      const db = getDB();
      
      const query: any = {};
      
      // Default behavior for public feed: show active ads only
      if (!status) {
        query.status = 'active';
      } else {
        query.status = status;
      }

      // Hide own ads from public feed for logged-in users
      if (currentUserId && !ownerId && !isAdmin) {
        query.ownerId = { $ne: currentUserId };
      }
      
      // Filter by placement if specified
      if (placement) {
        query.placement = placement;
      }
      
      // Filter by owner if specified (Admins or owner check above)
      if (ownerId) {
        query.ownerId = ownerId;
        if (ownerType) {
          query.ownerType = ownerType;
        }
      }
      
      // Filter by hashtags if specified
      if (hashtags) {
        const searchTags = Array.isArray(hashtags) ? hashtags : [hashtags];
        query.hashtags = { $in: searchTags };
      }
      
      // Filter out expired ads
      const now = Date.now();
      query.$or = [
        { expiryDate: { $exists: false } },
        { expiryDate: { $gt: now } }
      ];
      
      // Fetch ads with aggregation for sorting and metrics
      const skip = (Number(page) - 1) * Number(limit);
      const ads = await db.collection('ads').aggregate([ 
        { $match: query }, 
      
        // attach owner's active subscription (if any) 
        { 
          $lookup: { 
            from: 'adSubscriptions', 
            let: { ownerId: '$ownerId', ownerType: '$ownerType' }, 
            pipeline: [ 
              { 
                $match: { 
                  $expr: { 
                    $and: [ 
                      { 
                        $or: [
                          { $and: [{ $eq: ['$ownerId', '$$ownerId'] }, { $eq: ['$ownerType', '$$ownerType'] }] },
                          { $and: [{ $eq: ['$userId', '$$ownerId'] }, { $eq: ['$ownerType', '$$ownerType'] }] },
                          // legacy support: if ownerType is user, match documents without ownerType
                          { 
                            $and: [
                              { $eq: ['$$ownerType', 'user'] },
                              { $eq: ['$userId', '$$ownerId'] },
                              { $not: ['$ownerType'] }
                            ]
                          }
                        ]
                      },
                      { $eq: ['$status', 'active'] }, 
                      { 
                        $or: [ 
                          { $not: ['$endDate'] }, 
                          { $gt: ['$endDate', now] } 
                        ] 
                      } 
                    ] 
                  } 
                } 
              }, 
              { $sort: { createdAt: -1 } }, 
              { $limit: 1 } 
            ], 
            as: 'sub' 
          } 
        }, 
        { $addFields: { sub: { $arrayElemAt: ['$sub', 0] } } }, 
      
        // compute tierWeight 
        { 
          $addFields: { 
            tierWeight: { 
              $switch: { 
                branches: [ 
                  { case: { $eq: ['$sub.packageId', 'pkg-enterprise'] }, then: 3 }, 
                  { case: { $eq: ['$sub.packageId', 'pkg-pro'] }, then: 2 }, 
                  { case: { $eq: ['$sub.packageId', 'pkg-starter'] }, then: 1 } 
                ], 
                default: 0 
              } 
            } 
          } 
        }, 
      
        // your existing reaction sum 
        { 
          $addFields: { 
            totalReactions: { 
              $sum: { 
                $map: { 
                  input: { $objectToArray: { $ifNull: ['$reactions', {}] } }, 
                  as: 'r', 
                  in: '$$r.v' 
                } 
              } 
            } 
          } 
        }, 

        { 
          $addFields: { 
            boostWeight: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isBoosted', true] },
                    {
                      $or: [
                        { $not: ['$boostedUntil'] },
                        { $gt: ['$boostedUntil', now] }
                      ]
                    }
                  ]
                },
                {
                  $add: [
                    2000000,
                    { $multiply: [{ $ifNull: ['$boostCredits', 50] }, 20000] }
                  ]
                },
                0
              ]
            }
          } 
        }, 
      
        // score: tier first, then engagement, then recency 
        { 
          $addFields: { 
            signalScore: { 
              $add: [ 
                { $multiply: ['$tierWeight', 1000000] }, 
                '$boostWeight',
                { $multiply: ['$totalReactions', 1000] }, 
                '$timestamp' 
              ] 
            } 
          } 
        }, 
      
        { $sort: { signalScore: -1 } }, 
        { $skip: skip }, 
        { $limit: Number(limit) } 
      ]).toArray();
      
      // Add userReactions for current user
      if (currentUserId) {
        ads.forEach((ad: any) => {
          if (ad.reactionUsers) {
            ad.userReactions = Object.keys(ad.reactionUsers).filter(emoji => 
              Array.isArray(ad.reactionUsers[emoji]) && ad.reactionUsers[emoji].includes(currentUserId)
            );
          } else {
            ad.userReactions = [];
          }
        });
      }
      
      const total = await db.collection('ads').countDocuments(query);
      
      res.json({
        success: true,
        data: ads,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      });
    } catch (error) {
      console.error('Error fetching ads:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch ads' });
    }
  },

  // POST /api/ads - Create a new ad
  createAd: async (req: Request, res: Response) => {
    try {
      const db = getDB();
      const currentUser = (req as any).user;
      const adData = sanitizeAdCreatePayload(req.body);
      
      if (!currentUser || !currentUser.id) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const userId = currentUser.id;
      const requestedOwnerId = typeof (req.body as any)?.ownerId === 'string'
        ? (req.body as any).ownerId
        : userId;
      const requestedOwnerType = typeof (req.body as any)?.ownerType === 'string'
        ? (req.body as any).ownerType
        : 'user';

      // Ensure required fields
      if (!adData.headline || !adData.description) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing required fields',
          message: 'Ad headline and description are required to create an ad.'
        });
      }

      // Resolve effective actor identity
      const actor = await resolveIdentityActor(userId, { ownerType: requestedOwnerType, ownerId: requestedOwnerId });

      if (!actor) {
        return res.status(403).json({
          success: false,
          error: 'Permission denied',
          message: 'You do not have permission to create ads for this identity.'
        });
      }

      const effectiveOwnerId = actor.id;
      const effectiveOwnerType = actor.type;

      let reservedSubscriptionId: string | null = null;
      let subscription: any | null = null;
      const now = Date.now();

      // Check subscription limits and enforce at ACTION TIME
      // Fetch active subscription for the owner (user or company)
      const subscriptionQuery: any = {
        status: 'active',
        $or: [
          { endDate: { $exists: false } },
          { endDate: { $gt: now } }
        ],
        $and: [
          {
            $or: [
              { ownerId: effectiveOwnerId, ownerType: effectiveOwnerType },
              { userId: effectiveOwnerId, ownerType: effectiveOwnerType } // backward compatibility
            ]
          }
        ]
      };

      // If looking for user type, also match legacy documents without ownerType
      if (effectiveOwnerType === 'user') {
        (subscriptionQuery.$and[0] as any).$or.push({ userId: effectiveOwnerId, ownerType: { $exists: false } });
      }

      subscription = await db.collection('adSubscriptions').findOne(subscriptionQuery);

      if (subscription) {
         // Ensure period is current before checking limits
         subscription = await ensureCurrentPeriod(db, subscription);
      }

      // If no active subscription, allow creation only if they have credits? 
      // OR strictly enforce plan.
      // Based on "pkg-starter" being $39, we should require a subscription.
      if (!subscription) {
         return res.status(403).json({
           success: false,
           error: 'No active ad plan',
           message: 'No active ad plan found. Please purchase a plan to create ads.'
         });
      }

      // Check active ads limit
      const plan = AD_PLANS[subscription.packageId as keyof typeof AD_PLANS];
      const activeAdsLimit = plan ? plan.activeAdsLimit : 0;

      if (activeAdsLimit > 0) {
        const activeAdsCount = await db.collection('ads').countDocuments({
          ownerId: effectiveOwnerId,
          ownerType: effectiveOwnerType,
          status: 'active'
        });

        if (activeAdsCount >= activeAdsLimit) {
          return res.status(403).json({
            success: false,
            code: 'ACTIVE_AD_LIMIT_REACHED',
            error: 'Active ad limit reached',
            message: `You have reached your limit of ${activeAdsLimit} active ads for your current plan. Please deactivate an existing ad or upgrade your plan.`,
            limit: activeAdsLimit,
            current: activeAdsCount
          });
        }
      }

      // Check impression limit
      if (subscription.impressionsUsed >= subscription.impressionLimit) {
        return res.status(403).json({
          success: false,
          error: `Monthly impression limit reached (${subscription.impressionLimit}). Upgrade or wait for renewal.`,
          limit: subscription.impressionLimit,
          current: subscription.impressionsUsed
        });
      }

      if (subscription.adsUsed >= subscription.adLimit) {
        return res.status(403).json({
          success: false,
          code: 'AD_LIMIT_REACHED',
          error: 'Ad placement limit reached for this billing cycle',
          message: `You have used ${subscription.adsUsed} of ${subscription.adLimit} ad placements for this billing cycle.`,
          currentUsage: subscription.adsUsed,
          limit: subscription.adLimit,
          resetDate: subscription.periodEnd ? new Date(subscription.periodEnd).toISOString() : undefined
        });
      }

      // Reserve one ad slot atomically so concurrent requests cannot bypass quota.
      const reserveFilter: any = {
        _id: subscription._id,
        status: 'active',
        adsUsed: { $lt: subscription.adLimit },
        $or: [
          { endDate: { $exists: false } },
          { endDate: { $gt: now } }
        ]
      };

      // Ensure we are still in the same billing window that was validated above.
      if (subscription.periodEnd) {
        reserveFilter.periodEnd = subscription.periodEnd;
      }

      const reserved = await db.collection('adSubscriptions').findOneAndUpdate(
        reserveFilter,
        {
          $inc: { adsUsed: 1 },
          $set: { updatedAt: Date.now() }
        },
        { returnDocument: 'after' }
      );

      const reservedDoc: any = reserved && typeof reserved === 'object' && 'value' in reserved
        ? (reserved as any).value
        : reserved;

      if (!reservedDoc) {
        return res.status(403).json({
          success: false,
          code: 'AD_LIMIT_REACHED',
          error: 'Ad placement limit reached for this billing cycle',
          message: 'No ad slots are currently available. Please wait for renewal or upgrade your plan.'
        });
      }

      reservedSubscriptionId = subscription.id;
      subscription = reservedDoc;

      const ownerCollection = effectiveOwnerType === 'company' ? 'companies' : 'users';
      const ownerRecord = await db.collection(ownerCollection).findOne({ id: effectiveOwnerId });
      const ownerName = typeof ownerRecord?.name === 'string' && ownerRecord.name.trim()
        ? ownerRecord.name.trim()
        : (currentUser.name || 'Aura Social');
      const ownerAvatar = typeof ownerRecord?.avatar === 'string' && ownerRecord.avatar.trim()
        ? ownerRecord.avatar.trim()
        : (currentUser.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(ownerName)}`);
      const ownerAvatarType = ownerRecord?.avatarType === 'video' ? 'video' : 'image';
      const ownerEmail = typeof ownerRecord?.email === 'string' ? ownerRecord.email : undefined;
      const ownerActiveGlow = typeof ownerRecord?.activeGlow === 'string'
        ? ownerRecord.activeGlow
        : (currentUser.activeGlow || 'none');

      const newAd = {
        headline: adData.headline as string,
        description: adData.description as string,
        mediaUrl: typeof adData.mediaUrl === 'string' ? adData.mediaUrl : '',
        mediaType: adData.mediaType === 'video' ? 'video' : 'image',
        ctaText: adData.ctaText as string,
        ctaLink: adData.ctaLink as string,
        ctaPositionX: Number.isFinite(adData.ctaPositionX as number) ? Number(adData.ctaPositionX) : 50,
        ctaPositionY: Number.isFinite(adData.ctaPositionY as number) ? Number(adData.ctaPositionY) : 84,
        campaignWhy: AD_ALLOWED_CAMPAIGN_WHY.has(adData.campaignWhy as AdCampaignWhy)
          ? (adData.campaignWhy as AdCampaignWhy)
          : 'safe_clicks_conversions',
        leadCapture: adData.leadCapture && typeof adData.leadCapture === 'object'
          ? (adData.leadCapture as SanitizedLeadCaptureConfig)
          : { type: 'none' as AdLeadCaptureType },
        placement: adData.placement as string,
        expiryDate: adData.expiryDate as number | undefined,
        ownerId: effectiveOwnerId,
        ownerType: effectiveOwnerType,
        ownerName,
        ownerAvatar,
        ownerAvatarType,
        ownerEmail,
        ownerActiveGlow, // Enforce from trusted identity profile object
        isSponsored: true,
        status: 'active',
        id: `ad-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        reactions: {},
        reactionUsers: {},
        hashtags: getHashtagsFromText((adData.description as string) || '')
      };

      try {
        await db.collection('ads').insertOne(newAd);

        await db.collection('adAnalytics').insertOne({
        adId: newAd.id,
        ownerId: newAd.ownerId,
        ownerType: newAd.ownerType,
        impressions: 0,
        clicks: 0,
        ctr: 0,
        reach: 0,
        engagement: 0,
        conversions: 0,
        spend: 0,
        lastUpdated: Date.now()
        });
      } catch (error) {
        console.error('Error during ad creation transaction:', error);
        // Roll back reserved quota if insertion fails after slot reservation.
        if (reservedSubscriptionId) {
          try {
            await db.collection('adSubscriptions').updateOne(
              {
                id: reservedSubscriptionId,
                ownerId: effectiveOwnerId,
                ownerType: effectiveOwnerType,
                adsUsed: { $gt: 0 }
              },
              {
                $inc: { adsUsed: -1 },
                $set: { updatedAt: Date.now() }
              }
            );
          } catch (rollbackError) {
            console.error('Failed to roll back reserved ad slot:', rollbackError);
          }
        }
        throw error;
      }

      res.status(201).json({
        success: true,
        data: newAd,
        message: 'Ad created successfully',
        subscriptionUsage: subscription
          ? {
              adsUsed: subscription.adsUsed,
              adLimit: subscription.adLimit,
              resetDate: subscription.periodEnd ? new Date(subscription.periodEnd).toISOString() : undefined
            }
          : undefined
      });
    } catch (error) {
      console.error('Error creating ad:', error);
      res.status(500).json({ success: false, error: 'Failed to create ad' });
    }
  },

  // POST /api/ads/:id/react - React to an ad
  reactToAd: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reaction } = req.body;
      const currentUser = (req as any).user;
      if (!currentUser?.id) return res.status(401).json({ success: false, error: 'Authentication required' });
      const userId = currentUser.id;
      const db = getDB();

      const ad = await db.collection('ads').findOne({ id });
      if (!ad) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }

      const reactionUsers = ad.reactionUsers || {};
      const reactions = ad.reactions || {};
      
      // Initialize if needed
      if (!reactionUsers[reaction]) reactionUsers[reaction] = [];
      if (!reactions[reaction]) reactions[reaction] = 0;

      // Toggle reaction
      const userIndex = reactionUsers[reaction].indexOf(userId);
      if (userIndex > -1) {
        // Remove reaction
        reactionUsers[reaction].splice(userIndex, 1);
        reactions[reaction] = Math.max(0, reactions[reaction] - 1);
        if (reactions[reaction] === 0) delete reactions[reaction];
      } else {
        // Add reaction
        reactionUsers[reaction].push(userId);
        reactions[reaction]++;
      }

      await db.collection('ads').updateOne(
        { id },
        { 
          $set: { 
            reactions,
            reactionUsers
          } 
        }
      );

      // Calculate userReactions
      const userReactions = Object.keys(reactionUsers).filter(emoji => 
        reactionUsers[emoji].includes(userId)
      );

      res.json({
        success: true,
        data: {
          reactions,
          userReactions
        }
      });
    } catch (error) {
      console.error('Error reacting to ad:', error);
      res.status(500).json({ success: false, error: 'Failed to react to ad' });
    }
  },

  // POST /api/ads/:id/boost - Boost ad reach and deduct user credits
  boostAd: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const authenticatedUserId = (req as any).user?.id as string | undefined;
      const { credits } = req.body as { credits?: number | string };
      const db = getDB();

      if (!authenticatedUserId) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
      }

      const ad = await db.collection('ads').findOne({ id });
      if (!ad) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }

      const parsedCredits = typeof credits === 'string' ? Number(credits) : credits;
      const creditsToSpend = typeof parsedCredits === 'number' && Number.isFinite(parsedCredits) && parsedCredits > 0
        ? Math.max(1, Math.round(parsedCredits))
        : 50;

      const creditUpdateResult: any = await db.collection('users').findOneAndUpdate(
        { id: authenticatedUserId, auraCredits: { $gte: creditsToSpend } },
        {
          $inc: { auraCredits: -creditsToSpend, auraCreditsSpent: creditsToSpend },
          $set: { updatedAt: new Date().toISOString() }
        },
        {
          returnDocument: 'before',
          projection: { auraCredits: 1 }
        }
      );

      const userBeforeDebit = creditUpdateResult && typeof creditUpdateResult === 'object' && 'value' in creditUpdateResult
        ? creditUpdateResult.value
        : creditUpdateResult;

      if (!userBeforeDebit) {
        const existingUser = await db.collection('users').findOne(
          { id: authenticatedUserId },
          { projection: { auraCredits: 1 } }
        );
        if (!existingUser) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }
        return res.status(400).json({ success: false, error: 'Insufficient credits' });
      }

      const currentCredits = Number(userBeforeDebit.auraCredits || 0);
      const newCredits = currentCredits - creditsToSpend;

      const now = Date.now();
      const boostedUntil = now + (72 * 60 * 60 * 1000);

      try {
        await db.collection('ads').updateOne(
          { id },
          {
            $set: {
              isBoosted: true,
              boostedAt: now,
              boostedUntil,
              updatedAt: new Date().toISOString()
            },
            $inc: {
              boostCredits: creditsToSpend
            }
          }
        );

        await db.collection('adAnalytics').updateOne(
          { adId: id },
          {
            $inc: { spend: creditsToSpend },
            $set: { lastUpdated: now }
          },
          { upsert: true }
        );

        const boostedAd = await db.collection('ads').findOne({ id });
        if (!boostedAd) {
          await db.collection('users').updateOne(
            { id: authenticatedUserId },
            {
              $inc: { auraCredits: creditsToSpend, auraCreditsSpent: -creditsToSpend },
              $set: { updatedAt: new Date().toISOString() }
            }
          );
          return res.status(500).json({ success: false, error: 'Failed to boost ad' });
        }

        try {
          await emitAdAnalyticsUpdate(req.app as any, id, ad.ownerId, ad.ownerType || 'user');
        } catch (emitError) {
          console.error('Failed to emit ad analytics update after boost:', emitError);
        }

        return res.json({ success: true, data: boostedAd, message: 'Ad boosted successfully' });
      } catch (boostError) {
        await db.collection('users').updateOne(
          { id: authenticatedUserId },
          {
            $inc: { auraCredits: creditsToSpend, auraCreditsSpent: -creditsToSpend },
            $set: { updatedAt: new Date().toISOString() }
          }
        );
        throw boostError;
      }
    } catch (error) {
      console.error('Error boosting ad:', error);
      res.status(500).json({ success: false, error: 'Failed to boost ad' });
    }
  },

  // GET /api/ads/:id - Get ad by ID
  getAdById: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      const ad = await db.collection('ads').findOne({ id });
      
      if (!ad) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }
      
      res.json({ success: true, data: ad });
    } catch (error) {
      console.error('Error fetching ad:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch ad' });
    }
  },

  // PUT /api/ads/:id - Update ad
  updateAd: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = sanitizeAdUpdates(req.body);
      const db = getDB();

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid fields to update',
          message: 'No mutable ad fields were provided.'
        });
      }

      if (typeof updates.description === 'string') {
        updates.hashtags = getHashtagsFromText(updates.description || '');
      }
      
      const ad = await db.collection('ads').findOne({ id });
      if (!ad) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }

      const currentUser = (req as any).user;
      const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
      
      if (!isAdmin) {
        if (!currentUser) {
          return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const actor = await resolveIdentityActor(currentUser.id, { 
          ownerId: ad.ownerId, 
          ownerType: ad.ownerType || 'user' 
        });

        if (!actor || actor.id !== ad.ownerId) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
      }

      const result = await db.collection('ads').findOneAndUpdate(
        { id },
        { $set: { ...updates, updatedAt: new Date().toISOString() } },
        { returnDocument: 'after' }
      );
      
      if (!result) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }
      
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error updating ad:', error);
      res.status(500).json({ success: false, error: 'Failed to update ad' });
    }
  },

  // DELETE /api/ads/:id - Delete ad
  deleteAd: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      const currentUser = (req as any).user;

      if (!currentUser || !currentUser.id) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
          message: 'Please log in to delete ads'
        });
      }

      const ad = await db.collection('ads').findOne({ id });
      if (!ad) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }

      const isAdmin = currentUser.role === 'admin' || currentUser.isAdmin === true;
      
      if (!isAdmin) {
        const actor = await resolveIdentityActor(currentUser.id, { 
          ownerId: ad.ownerId, 
          ownerType: ad.ownerType || 'user' 
        });

        if (!actor || actor.id !== ad.ownerId) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden',
            message: 'You do not have permission to delete this ad'
          });
        }
      }
      
      const result = await db.collection('ads').deleteOne({ id });
      
      if (result.deletedCount === 0) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }
      
      res.json({ success: true, message: 'Ad deleted successfully' });
    } catch (error) {
      console.error('Error deleting ad:', error);
      res.status(500).json({ success: false, error: 'Failed to delete ad' });
    }
  },

  // PUT /api/ads/:id/status - Update ad status
  updateAdStatus: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const db = getDB();
      const currentUser = (req as any).user;

      if (!currentUser || !currentUser.id) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const ad = await db.collection('ads').findOne({ id });
      if (!ad) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }

      const isAdmin = currentUser.role === 'admin' || currentUser.isAdmin === true;
      
      if (!isAdmin) {
        const actor = await resolveIdentityActor(currentUser.id, { 
          ownerId: ad.ownerId, 
          ownerType: ad.ownerType || 'user' 
        });

        if (!actor || actor.id !== ad.ownerId) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
      }
      
      // Enforce limits if activating
      if (status === 'active' && ad.status !== 'active') {
        // Get active subscription
        const now = Date.now();
        const effectiveOwnerId = ad.ownerId;
        const effectiveOwnerType = ad.ownerType || 'user';

        const subscriptionQuery: any = {
          status: 'active',
          $or: [
            { endDate: { $exists: false } },
            { endDate: { $gt: now } }
          ],
          $and: [
            {
              $or: [
                { ownerId: effectiveOwnerId, ownerType: effectiveOwnerType },
                { userId: effectiveOwnerId, ownerType: effectiveOwnerType } // backward compatibility
              ]
            }
          ]
        };

        // If looking for user type, also match legacy documents without ownerType
        if (effectiveOwnerType === 'user') {
          (subscriptionQuery.$and[0] as any).$or.push({ userId: effectiveOwnerId, ownerType: { $exists: false } });
        }

        let subscription = await db.collection('adSubscriptions').findOne(subscriptionQuery);

        if (subscription) {
           // Ensure period is current before checking limits
           subscription = await ensureCurrentPeriod(db, subscription);
        }

        // Enforce active ads limit
        if (subscription) {
          const plan = AD_PLANS[subscription.packageId as keyof typeof AD_PLANS];
          const activeAdsLimit = plan ? plan.activeAdsLimit : 0; // Default to 0 if plan not found or limit not defined

          if (activeAdsLimit > 0) {
            const activeAdsCount = await db.collection('ads').countDocuments({
        ownerId: ad.ownerId,
        ownerType: ad.ownerType || 'user',
        status: 'active'
      });

            if (activeAdsCount >= activeAdsLimit) {
              return res.status(403).json({
                success: false,
                code: 'ACTIVE_AD_LIMIT_REACHED',
                error: 'Active ad limit reached',
                message: `You have reached your limit of ${activeAdsLimit} active ads for your current plan. Please deactivate an existing ad or upgrade your plan.`,
                limit: activeAdsLimit,
                current: activeAdsCount
              });
            }
          }
        }

        // Check impression limit
        if (subscription && subscription.impressionsUsed >= subscription.impressionLimit) {
           return res.status(403).json({
             success: false,
             error: `Monthly impression limit reached (${subscription.impressionLimit}). Upgrade or wait for renewal.`,
             limit: subscription.impressionLimit,
             current: subscription.impressionsUsed
           });
        }
      }

      const result = await db.collection('ads').findOneAndUpdate(
        { id },
        { $set: { status } },
        { returnDocument: 'after' }
      );

      // Emit real-time update
      emitAdAnalyticsUpdate(req.app, id, ad.ownerId, ad.ownerType || 'user');
      
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error updating ad status:', error);
      res.status(500).json({ success: false, error: 'Failed to update ad status' });
    }
  },

  getAdAnalytics: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();

      const ad = await db.collection('ads').findOne({ id });
      if (!ad) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }

      const currentUser = (req as any).user;
      const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
      
      if (!isAdmin) {
        if (!currentUser) {
          return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const actor = await resolveIdentityActor(currentUser.id, { 
          ownerId: ad.ownerId, 
          ownerType: ad.ownerType || 'user' 
        });

        if (!actor || actor.id !== ad.ownerId) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden',
            message: 'You do not have access to this ad analytics'
          });
        }
      }

      const analytics = await db.collection('adAnalytics').findOne({ adId: id });

      // Check owner subscription level
      const now = Date.now();
      const effectiveOwnerId = ad.ownerId;
      const effectiveOwnerType = ad.ownerType || 'user';

      const subscriptionQuery: any = {
        status: 'active',
        $or: [
          { endDate: { $exists: false } },
          { endDate: { $gt: now } }
        ],
        $and: [
          {
            $or: [
              { ownerId: effectiveOwnerId, ownerType: effectiveOwnerType },
              { userId: effectiveOwnerId, ownerType: effectiveOwnerType } // backward compatibility
            ]
          }
        ]
      };

      // If looking for user type, also match legacy documents without ownerType
      if (effectiveOwnerType === 'user') {
        (subscriptionQuery.$and[0] as any).$or.push({ userId: effectiveOwnerId, ownerType: { $exists: false } });
      }

      const subscription = await db.collection('adSubscriptions').findOne(subscriptionQuery);

      const packageId = subscription ? subscription.packageId : 'pkg-starter';
      const isBasic = packageId === 'pkg-starter';
      const isPro = packageId === 'pkg-pro';
      const isEnterprise = packageId === 'pkg-enterprise';

      const impressions = analytics?.impressions ?? 0;
      const clicks = analytics?.clicks ?? 0;
      const engagement = analytics?.engagement ?? 0;
      const conversions = analytics?.conversions ?? 0;
      const spend = analytics?.spend ?? 0;
      const lastUpdated = analytics?.lastUpdated ?? Date.now();

      // Calculate unique reach for the last 7 days
      const days = 7;
      const startDate = new Date();
      startDate.setUTCHours(0, 0, 0, 0);
      startDate.setUTCDate(startDate.getUTCDate() - (days - 1));

      const dateKeys: string[] = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setUTCDate(startDate.getUTCDate() + i);
        dateKeys.push(d.toISOString().slice(0, 10));
      }

      const dailyReachDocs = await db.collection('adAnalyticsDaily')
        .find({ adId: id, dateKey: { $in: dateKeys } })
        .toArray();

      const reach = dailyReachDocs.reduce((sum, doc) => sum + (doc.uniqueReach || 0), 0);

      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

      const data: any = {
        adId: id,
        impressions,
        clicks,
        ctr,
        reach,
        engagement,
        conversions,
        spend,
        lastUpdated
      };

      if (!isBasic) {
        // data.engagement = engagement; // Always include for consistency
        // data.spend = spend; // Always include for consistency
      }

      if (isEnterprise) {
        data.audience = null; // coming soon
        data.audienceStatus = 'coming_soon';
      }

      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error fetching ad analytics:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch ad analytics' });
    }
  },

  getUserAdPerformance: async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const ownerType = (req.query.ownerType as string) || 'user';
      const ownerId = userId; // In this route, the param is named userId but could be companyId
      const db = getDB();

      const currentUser = (req as any).user;
      const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
      
      // Security check
      if (!isAdmin) {
        if (!currentUser) {
          return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const actor = await resolveIdentityActor(currentUser.id, { 
          ownerId: ownerId, 
          ownerType: ownerType as string 
        });

        if (!actor || actor.id !== ownerId) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
      }

      const ads = await db.collection('ads').find({ ownerId, ownerType }).toArray();
      if (!ads || ads.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const adIds = ads.map((ad: any) => ad.id);
      const analyticsDocs = await db
        .collection('adAnalytics')
        .find({ adId: { $in: adIds } })
        .toArray();

      // Check user/company subscription level
      const now = Date.now();
      const effectiveOwnerId = ownerId;
      const effectiveOwnerType = ownerType;

      const subscriptionQuery: any = {
        status: 'active',
        $or: [
          { endDate: { $exists: false } },
          { endDate: { $gt: now } }
        ],
        $and: [
          {
            $or: [
              { ownerId: effectiveOwnerId, ownerType: effectiveOwnerType },
              { userId: effectiveOwnerId, ownerType: effectiveOwnerType } // backward compatibility
            ]
          }
        ]
      };

      // If looking for user type, also match legacy documents without ownerType
      if (effectiveOwnerType === 'user') {
        (subscriptionQuery.$and[0] as any).$or.push({ userId: effectiveOwnerId, ownerType: { $exists: false } });
      }

      const subscription = await db.collection('adSubscriptions').findOne(subscriptionQuery);

      const packageId = subscription ? subscription.packageId : 'pkg-starter';

      const analyticsMap = new Map<string, any>();
      analyticsDocs.forEach(doc => {
        analyticsMap.set(doc.adId, doc);
      });

      const data = ads.map((ad: any) => {
        const analytics = analyticsMap.get(ad.id);
        const impressions = analytics?.impressions ?? 0;
        const clicks = analytics?.clicks ?? 0;
        const engagement = analytics?.engagement ?? 0;
        const conversions = analytics?.conversions ?? 0;
        const spend = analytics?.spend ?? 0;
        const reach = analytics?.reach ?? impressions;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const lastUpdated = analytics?.lastUpdated ?? ad.timestamp;

        return {
          adId: ad.id,
          adName: ad.headline,
          status: ad.status,
          impressions,
          clicks,
          ctr,
          engagement,
          spend,
          reach,
          conversions,
          lastUpdated,
          roi: spend > 0 ? (engagement + clicks) / spend : 0,
          createdAt: ad.timestamp
        };
      });

      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error fetching user ad performance:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch user ad performance' });
    }
  },

  getCampaignPerformance: async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const ownerType = (req.query.ownerType as string) || 'user';
      const ownerId = userId;
      const db = getDB();

      const currentUser = (req as any).user;
      const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.isAdmin === true);
      
      // Security check
      if (!isAdmin) {
        if (!currentUser) {
          return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const actor = await resolveIdentityActor(currentUser.id, { 
          ownerId: ownerId, 
          ownerType: ownerType as string 
        });

        if (!actor || actor.id !== ownerId) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }
      }

      const ads = await db.collection('ads').find({ ownerId, ownerType }).toArray();
      if (!ads || ads.length === 0) {
        return res.json({
          success: true,
          data: {
            totalImpressions: 0,
            totalClicks: 0,
            totalReach: 0,
            totalEngagement: 0,
            totalSpend: 0,
            averageCTR: 0,
            activeAds: 0,
            performanceScore: 0,
            trendData: []
          }
        });
      }

      // Check user/company subscription level
      const now = Date.now();
      const effectiveOwnerId = ownerId;
      const effectiveOwnerType = ownerType;

      const subscriptionQuery: any = {
        status: 'active',
        $or: [
          { endDate: { $exists: false } },
          { endDate: { $gt: now } }
        ],
        $and: [
          {
            $or: [
              { ownerId: effectiveOwnerId, ownerType: effectiveOwnerType },
              { userId: effectiveOwnerId, ownerType: effectiveOwnerType } // backward compatibility
            ]
          }
        ]
      };

      // If looking for user type, also match legacy documents without ownerType
      if (effectiveOwnerType === 'user') {
        (subscriptionQuery.$and[0] as any).$or.push({ userId: effectiveOwnerId, ownerType: { $exists: false } });
      }

      const subscription = await db.collection('adSubscriptions').findOne(subscriptionQuery);

      const packageId = subscription ? subscription.packageId : 'pkg-starter';
      const isBasic = packageId === 'pkg-starter';
      // const isPro = packageId === 'pkg-pro';
      // const isEnterprise = packageId === 'pkg-enterprise';

      let totalImpressions = 0;
      let totalClicks = 0;
      let totalEngagement = 0;
      let totalSpend = 0;
      let totalConversions = 0;
      let activeAds = 0;
      let totalReach = 0;

      const adIds = ads.map((ad: any) => ad.id);
      const analyticsDocs = await db
        .collection('adAnalytics')
        .find({ adId: { $in: adIds } })
        .toArray();

      const analyticsMap = new Map<string, any>();
      analyticsDocs.forEach(doc => {
        analyticsMap.set(doc.adId, doc);
      });

      ads.forEach((ad: any) => {
        if (ad.status === 'active') activeAds++;
        
        const analytics = analyticsMap.get(ad.id);
        if (analytics) {
          totalImpressions += (analytics.impressions ?? 0);
          totalClicks += (analytics.clicks ?? 0);
          
          // Include all metrics regardless of plan for now to ensure data visibility
          // We can enforce strict plan limits later if needed
          totalEngagement += (analytics.engagement ?? 0);
          totalSpend += (analytics.spend ?? 0);
          totalConversions += (analytics.conversions ?? 0);
          
          totalReach += (analytics.reach ?? analytics.impressions ?? 0);
        }
      });

      const averageCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      
      // Calculate a performance score (0-100)
      // Weighted: 30% CTR, 30% Engagement Rate, 40% active/fresh factor
      const ctrScore = Math.min(100, (averageCTR / 2) * 100); // 2% CTR = 100 score
      let performanceScore = 0;

      if (isBasic) {
        // For basic plan, weight: 50% CTR, 50% active/fresh
        performanceScore = Math.round((ctrScore * 0.5) + (Math.min(100, activeAds * 20) * 0.5));
      } else {
        const engRate = totalImpressions > 0 ? totalEngagement / totalImpressions : 0;
        const engScore = Math.min(100, (engRate / 0.05) * 100); // 5% engagement = 100 score
        performanceScore = Math.round((ctrScore * 0.3) + (engScore * 0.3) + (Math.min(100, activeAds * 20) * 0.4));
      }

      const daysToNextExpiry = subscription?.endDate 
        ? Math.ceil((subscription.endDate - now) / (1000 * 60 * 60 * 24))
        : null;

      const build7DayTrend = async (ownerId: string, ownerType: string) => {
        const days = 7;
        const start = new Date();
        start.setUTCHours(0, 0, 0, 0);
        start.setUTCDate(start.getUTCDate() - (days - 1));

        const keys: string[] = [];
        for (let i = 0; i < days; i++) {
          const d = new Date(start);
          d.setUTCDate(start.getUTCDate() + i);
          keys.push(d.toISOString().slice(0, 10));
        }

        const docs = await db.collection('adAnalyticsDaily')
          .find({ ownerId, ownerType, dateKey: { $in: keys } })
          .toArray();

        const map = new Map<string, any>();
        for (const k of keys) {
          const d = new Date(`${k}T00:00:00.000Z`);
          map.set(k, {
            date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            impressions: 0,
            clicks: 0,
            engagement: 0,
            spend: 0
          });
        }

        for (const doc of docs) {
          const row = map.get(doc.dateKey);
          if (!row) continue;
          row.impressions += doc.impressions || 0;
          row.clicks += doc.clicks || 0;
          row.engagement += doc.engagement || 0;
          row.spend += doc.spend || 0;
        }

        return Array.from(map.values());
      };

      const trendData = await build7DayTrend(ownerId, ownerType);

      const data: any = {
        totalImpressions,
        totalClicks,
        totalReach,
        totalEngagement,
        totalSpend,
        totalConversions,
        averageCTR,
        activeAds,
        daysToNextExpiry,
        performanceScore,
        trendData
      };

      res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Error fetching campaign performance:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch campaign performance' });
    }
  },

  trackImpression: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();
      const now = Date.now();
      const todayKey = dateKeyUTC(now);
      const userFingerprint = fingerprint(req);

      // 1. Get Ad to find owner and current status
      const ad = await db.collection('ads').findOne({ id });
      if (!ad) {
        return res.status(404).json({ success: false, error: 'Ad not found' });
      }

      // Only track impressions for active ads
      if (ad.status !== 'active') {
        return res.status(200).json({ success: true, message: 'Ad not active, impression not tracked.' });
      }

      // 2. Get Ad Owner's Subscription
      const effectiveOwnerId = ad.ownerId;
      const effectiveOwnerType = ad.ownerType || 'user';

      const subscriptionQuery: any = {
        status: 'active',
        $or: [
          { endDate: { $exists: false } },
          { endDate: { $gt: now } }
        ],
        $and: [
          {
            $or: [
              { ownerId: effectiveOwnerId, ownerType: effectiveOwnerType },
              { userId: effectiveOwnerId, ownerType: effectiveOwnerType } // backward compatibility
            ]
          }
        ]
      };

      // If looking for user type, also match legacy documents without ownerType
      if (effectiveOwnerType === 'user') {
        (subscriptionQuery.$and[0] as any).$or.push({ userId: effectiveOwnerId, ownerType: { $exists: false } });
      }

      let subscription = await db.collection('adSubscriptions').findOne(subscriptionQuery);

      if (!subscription) {
        return res.status(200).json({ success: true, message: 'No active subscription for ad owner, impression not tracked.' });
      }

      // Ensure subscription period is current (resets usage if new month)
      subscription = await ensureCurrentPeriod(db, subscription);

      if (!subscription) {
        return res.status(200).json({ success: true, message: 'Subscription check failed, impression not tracked.' });
      }

      const plan = AD_PLANS[subscription.packageId as keyof typeof AD_PLANS];
      if (!plan) {
        console.warn(`⚠️ Ad plan not found for packageId: ${subscription.packageId}`);
        return res.status(200).json({ success: true, message: 'Ad plan not found, impression not tracked.' });
      }

      // 3. Check Impression Limit (overall)
      if (subscription.impressionsUsed >= plan.impressionLimit) {
        return res.status(403).json({
          success: false,
          code: 'IMPRESSION_LIMIT_REACHED',
          error: `Monthly impression limit reached (${plan.impressionLimit}). Upgrade or wait for renewal.`,
          limit: plan.impressionLimit,
          current: subscription.impressionsUsed
        });
      }

      // 4. Deduplicate Impressions (per day, per user fingerprint)
      const dedupKey = `${id}-${todayKey}-${userFingerprint}`;
      const existingDedupe = await db.collection('adEventDedupes').findOne({ key: dedupKey });

      if (existingDedupe) {
        return res.status(200).json({ success: true, message: 'Duplicate impression, not tracked.' });
      }

      // Record deduplication key
      await db.collection('adEventDedupes').insertOne({
        key: dedupKey,
        adId: id,
        ownerId: ad.ownerId,
        ownerType: ad.ownerType || 'user',
        dateKey: todayKey,
        fingerprint: userFingerprint,
        timestamp: now,
        expiresAt: new Date(now + 24 * 60 * 60 * 1000) // Expires in 24 hours
      });

      // Increment uniqueReach in adAnalyticsDaily
      await db.collection('adAnalyticsDaily').updateOne(
        { adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', dateKey: todayKey },
        { $inc: { uniqueReach: 1 } },
        { upsert: true }
      );

      // 5. Determine Cost Per Impression (CPI)
      let cpi = 0;
      if (plan.impressionLimit > 0 && plan.numericPrice) {
        cpi = plan.numericPrice / plan.impressionLimit;
      }

      // 6. Atomically Update Ad Analytics and Subscription Usage
      // Update adAnalytics
      await db.collection('adAnalytics').updateOne(
        { adId: id },
        {
          $inc: {
            impressions: 1,
            spend: cpi
          },
          $set: { 
            lastUpdated: now,
            ownerId: ad.ownerId,
            ownerType: ad.ownerType || 'user'
          }
        },
        { upsert: true }
      );

      // Update adSubscription impressionsUsed
      await db.collection('adSubscriptions').updateOne(
        { _id: subscription._id }, // Use _id for direct document update
        { $inc: { impressionsUsed: 1 }, $set: { updatedAt: now } }
      );

      // 7. Update Daily Rollup (for trends and accurate CTR calculation)
      await db.collection('adDailyRollups').updateOne(
        { adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', dateKey: todayKey },
        {
          $inc: { impressions: 1 },
          $set: { lastUpdated: now }
        },
        { upsert: true }
      );

      // 8. Recalculate CTR (optional, can be done in a separate job or on analytics fetch)
      // For now, we'll update it directly here for immediate accuracy
      const updatedAnalytics = await db.collection('adAnalytics').findOne({ adId: id });
      if (updatedAnalytics && updatedAnalytics.impressions > 0) {
        const newCtr = (updatedAnalytics.clicks / updatedAnalytics.impressions) * 100;
        await db.collection('adAnalytics').updateOne(
          { adId: id },
          { $set: { ctr: newCtr, lastUpdated: now } }
        );
      }

      // Emit real-time update
      emitAdAnalyticsUpdate(req.app, id, ad.ownerId, ad.ownerType || 'user');

      res.json({ success: true, message: 'Impression tracked successfully.' });
    } catch (error) {
      console.error('Error tracking impression:', error);
      res.status(500).json({ success: false, error: 'Failed to track impression' });
    }
  },

  trackClick: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();

      const ad = await db.collection('ads').findOne({ id });
      if (!ad) return res.status(404).json({ success: false, error: 'Ad not found' });

      const now = Date.now();
      const dKey = dateKeyUTC(now);
      const fp = fingerprint(req);

      const dedupe = await db.collection('adEventDedupes').updateOne(
        { adId: id, eventType: 'click', fingerprint: fp, dateKey: dKey },
        { $setOnInsert: { adId: id, ownerId: ad.ownerId, eventType: 'click', fingerprint: fp, dateKey: dKey, createdAt: now } },
        { upsert: true }
      );

      if (dedupe.upsertedCount === 0) return res.json({ success: true, deduped: true });

      await db.collection('adAnalytics').updateOne(
        { adId: id },
        [
          { $set: { clicks: { $add: [{ $ifNull: ['$clicks', 0] }, 1] }, lastUpdated: now } },
          {
            $set: {
              ctr: {
                $cond: [
                  { $gt: ['$impressions', 0] },
                  { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] },
                  0
                ]
              }
            }
          }
        ],
        { upsert: true }
      );

      await db.collection('adAnalyticsDaily').updateOne(
        { adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', dateKey: dKey },
        { $inc: { clicks: 1 }, $set: { updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );

      // Emit real-time update
      emitAdAnalyticsUpdate(req.app, id, ad.ownerId, ad.ownerType || 'user');

      res.json({ success: true });
    } catch (error) {
      console.error('Error tracking click:', error);
      res.status(500).json({ success: false, error: 'Failed to track click' });
    }
  },

  trackEngagement: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { engagementType } = req.body as { engagementType?: 'like' | 'comment' | 'share' };
      const db = getDB();

      const ad = await db.collection('ads').findOne({ id });
      if (!ad) return res.status(404).json({ success: false, error: 'Ad not found' });

      const now = Date.now();
      const dKey = dateKeyUTC(now);
      const fp = fingerprint(req);

      // dedupe engagement per day per type
      const dedupe = await db.collection('adEventDedupes').updateOne(
        { adId: id, eventType: `engagement:${engagementType || 'unknown'}`, fingerprint: fp, dateKey: dKey },
        { $setOnInsert: { adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', eventType: `engagement:${engagementType || 'unknown'}`, fingerprint: fp, dateKey: dKey, createdAt: now } },
        { upsert: true }
      );

      if (dedupe.upsertedCount === 0) {
        return res.json({ success: true, deduped: true });
      }

      const inc: any = { engagement: 1 };
      if (engagementType) inc[`engagementByType.${engagementType}`] = 1;

      await db.collection('adAnalytics').updateOne(
        { adId: id },
        { 
          $inc: inc, 
          $set: { 
            lastUpdated: now,
            ownerId: ad.ownerId,
            ownerType: ad.ownerType || 'user'
          } 
        },
        { upsert: true }
      );

      await db.collection('adAnalyticsDaily').updateOne(
        { adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', dateKey: dKey },
        { $inc: { engagement: 1, ...(engagementType ? { [`engagementByType.${engagementType}`]: 1 } : {}) }, $set: { updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );

      // Emit real-time update
      emitAdAnalyticsUpdate(req.app, id, ad.ownerId, ad.ownerType || 'user');

      res.json({ success: true });
    } catch (error) {
      console.error('Error tracking engagement:', error);
      res.status(500).json({ success: false, error: 'Failed to track engagement' });
    }
  },

  trackConversion: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDB();

      const ad = await db.collection('ads').findOne({ id });
      if (!ad) return res.status(404).json({ success: false, error: 'Ad not found' });

      const now = Date.now();
      const dKey = dateKeyUTC(now);
      const fp = fingerprint(req);

      const dedupe = await db.collection('adEventDedupes').updateOne(
        { adId: id, eventType: 'conversion', fingerprint: fp, dateKey: dKey },
        { $setOnInsert: { adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', eventType: 'conversion', fingerprint: fp, dateKey: dKey, createdAt: now } },
        { upsert: true }
      );

      if (dedupe.upsertedCount === 0) return res.json({ success: true, deduped: true });

      await db.collection('adAnalytics').updateOne(
        { adId: id },
        {
          $inc: { conversions: 1 },
          $set: { 
            lastUpdated: now,
            ownerId: ad.ownerId,
            ownerType: ad.ownerType || 'user'
          }
        },
        { upsert: true }
      );

      await db.collection('adAnalyticsDaily').updateOne(
        { adId: id, ownerId: ad.ownerId, ownerType: ad.ownerType || 'user', dateKey: dKey },
        { $inc: { conversions: 1 }, $set: { updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );

      // Emit real-time update
      emitAdAnalyticsUpdate(req.app, id, ad.ownerId, ad.ownerType || 'user');

      res.json({ success: true });
    } catch (error) {
      console.error('Error tracking conversion:', error);
      res.status(500).json({ success: false, error: 'Failed to track conversion' });
    }
  }
};
