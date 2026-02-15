import { Request, Response, Router } from 'express';
import { getDB } from '../db';
import { requireAdmin, requireAuth } from '../middleware/authMiddleware';

const router = Router();
const REPORT_STATUS_VALUES = new Set(['open', 'in_review', 'resolved', 'dismissed']);

const readIsoTimestamp = (value: unknown): string => {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date(0).toISOString();
};

const readMillis = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const previewText = (value: unknown, max = 140): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
};

const normalizeReportType = (report: any): 'post' | 'user' => {
  if (report?.type === 'post') return 'post';
  if (typeof report?.postId === 'string' && report.postId.trim().length > 0) return 'post';
  return 'user';
};

const isSuspendedMessage = (reason?: string) =>
  reason ? `Account suspended: ${reason}` : 'Account suspended. Contact support for assistance.';

router.use(requireAuth, requireAdmin);

router.get('/overview', async (_req: Request, res: Response) => {
  try {
    const db = getDB();
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

    const [users, reports, recentCompanySubscriptions, recentCreditTransactions] = await Promise.all([
      db.collection('users')
        .find({})
        .project({
          _id: 0,
          id: 1,
          name: 1,
          handle: 1,
          email: 1,
          createdAt: 1,
          isSuspended: 1,
          suspensionReason: 1
        })
        .toArray(),
      db.collection('reports')
        .find({})
        .sort({ createdAt: -1 })
        .limit(200)
        .toArray(),
      db.collection('adSubscriptions')
        .find({ ownerType: 'company' })
        .sort({ createdAt: -1 })
        .limit(120)
        .toArray(),
      db.collection('transactions')
        .find({ type: 'credit_purchase' })
        .sort({ createdAt: -1 })
        .limit(180)
        .toArray()
    ]);

    const userById = new Map<string, any>();
    users.forEach((user: any) => {
      if (typeof user?.id === 'string' && user.id.trim().length > 0) {
        userById.set(user.id, user);
      }
    });

    const reportPostIds = Array.from(
      new Set(
        reports
          .filter((report: any) => normalizeReportType(report) === 'post')
          .map((report: any) => (typeof report?.postId === 'string' ? report.postId : ''))
          .filter((id: string) => id.trim().length > 0)
      )
    );

    const reportPosts = reportPostIds.length > 0
      ? await db.collection('posts')
          .find({ id: { $in: reportPostIds } })
          .project({
            _id: 0,
            id: 1,
            content: 1,
            author: 1,
            visibility: 1,
            moderationHidden: 1
          })
          .toArray()
      : [];

    const postById = new Map<string, any>();
    reportPosts.forEach((post: any) => {
      if (typeof post?.id === 'string' && post.id.trim().length > 0) {
        postById.set(post.id, post);
      }
    });

    const unresolvedStatuses = new Set(['open', 'in_review', '']);
    const mappedReports = reports.map((report: any) => {
      const reportType = normalizeReportType(report);
      const postId = typeof report?.postId === 'string' ? report.postId : '';
      const targetPost = postId ? postById.get(postId) : undefined;
      const targetUserId =
        reportType === 'user'
          ? (typeof report?.targetUserId === 'string' ? report.targetUserId : '')
          : (typeof targetPost?.author?.id === 'string' ? targetPost.author.id : '');
      const reporterId = typeof report?.reporterId === 'string' ? report.reporterId : '';

      const reporter = reporterId ? userById.get(reporterId) : undefined;
      const targetUser = targetUserId ? userById.get(targetUserId) : undefined;
      const status = typeof report?.status === 'string' ? report.status : 'open';

      return {
        id: report?.id || report?._id?.toString?.() || '',
        type: reportType,
        status,
        reason: typeof report?.reason === 'string' ? report.reason : 'Not specified',
        notes: typeof report?.notes === 'string' ? report.notes : '',
        createdAt: readIsoTimestamp(report?.createdAt),
        reporter: reporter
          ? {
              id: reporter.id,
              name: reporter.name || 'Unknown',
              handle: reporter.handle || '',
              email: reporter.email || ''
            }
          : null,
        targetUser: targetUser
          ? {
              id: targetUser.id,
              name: targetUser.name || 'Unknown',
              handle: targetUser.handle || '',
              email: targetUser.email || '',
              isSuspended: !!targetUser.isSuspended,
              suspensionReason: targetUser.suspensionReason || ''
            }
          : (targetUserId
              ? {
                  id: targetUserId,
                  name: 'Unknown',
                  handle: '',
                  email: '',
                  isSuspended: false,
                  suspensionReason: ''
                }
              : null),
        post: targetPost
          ? {
              id: targetPost.id,
              preview: previewText(targetPost.content),
              authorName: targetPost.author?.name || 'Unknown',
              authorHandle: targetPost.author?.handle || '',
              visibility: targetPost.visibility || 'public',
              moderationHidden: !!targetPost.moderationHidden
            }
          : null,
        isUnresolved: unresolvedStatuses.has(status)
      };
    });

    const totalUsers = users.length;
    const signupsLast30Days = users.reduce((count: number, user: any) => {
      const createdAtMs = readMillis(user?.createdAt);
      return createdAtMs >= thirtyDaysAgo ? count + 1 : count;
    }, 0);
    const openPostReports = mappedReports.filter((report) => report.type === 'post' && report.isUnresolved).length;
    const openUserReports = mappedReports.filter((report) => report.type === 'user' && report.isUnresolved).length;

    const companyIds = Array.from(
      new Set(
        recentCompanySubscriptions
          .map((subscription: any) => (typeof subscription?.ownerId === 'string' ? subscription.ownerId : ''))
          .filter((id: string) => id.trim().length > 0)
      )
    );

    const companies = companyIds.length > 0
      ? await db.collection('companies')
          .find({ id: { $in: companyIds } })
          .project({ _id: 0, id: 1, name: 1, handle: 1 })
          .toArray()
      : [];

    const companyById = new Map<string, any>();
    companies.forEach((company: any) => {
      if (typeof company?.id === 'string' && company.id.trim().length > 0) {
        companyById.set(company.id, company);
      }
    });

    const packageBreakdownMap = new Map<string, number>();
    recentCompanySubscriptions.forEach((subscription: any) => {
      const label = (subscription?.packageName || subscription?.packageId || 'Unknown').toString();
      packageBreakdownMap.set(label, (packageBreakdownMap.get(label) || 0) + 1);
    });

    const companiesWithSubscriptions = new Set(
      recentCompanySubscriptions
        .map((subscription: any) => (typeof subscription?.ownerId === 'string' ? subscription.ownerId : ''))
        .filter((id: string) => id.trim().length > 0)
    );

    const companySubscriptions = recentCompanySubscriptions.map((subscription: any) => {
      const companyId = typeof subscription?.ownerId === 'string' ? subscription.ownerId : '';
      const company = companyById.get(companyId);
      const status = typeof subscription?.status === 'string' ? subscription.status : 'unknown';

      return {
        id: subscription?.id || '',
        companyId,
        companyName: company?.name || companyId || 'Unknown company',
        companyHandle: company?.handle || '',
        packageName: subscription?.packageName || subscription?.packageId || 'Unknown plan',
        status,
        startDate: readIsoTimestamp(subscription?.startDate),
        endDate: readIsoTimestamp(subscription?.endDate),
        createdAt: readIsoTimestamp(subscription?.createdAt),
        adsUsed: Number(subscription?.adsUsed || 0),
        adLimit: Number(subscription?.adLimit || 0)
      };
    });

    const creditUserIds = Array.from(
      new Set(
        recentCreditTransactions
          .map((transaction: any) => (typeof transaction?.userId === 'string' ? transaction.userId : ''))
          .filter((id: string) => id.trim().length > 0)
      )
    );

    const creditUsers = creditUserIds.length > 0
      ? await db.collection('users')
          .find({ id: { $in: creditUserIds } })
          .project({ _id: 0, id: 1, name: 1, handle: 1, email: 1 })
          .toArray()
      : [];

    const creditUserById = new Map<string, any>();
    creditUsers.forEach((user: any) => {
      if (typeof user?.id === 'string' && user.id.trim().length > 0) {
        creditUserById.set(user.id, user);
      }
    });

    const creditBundleMap = new Map<string, { purchases: number; credits: number }>();
    let totalCreditsSold = 0;

    const creditPurchases = recentCreditTransactions.map((transaction: any) => {
      const userId = typeof transaction?.userId === 'string' ? transaction.userId : '';
      const user = creditUserById.get(userId);
      const credits = Number(
        transaction?.credits ?? transaction?.amount ?? 0
      );
      const bundleName = (transaction?.bundleName || 'Unknown bundle').toString();

      const bucket = creditBundleMap.get(bundleName) || { purchases: 0, credits: 0 };
      bucket.purchases += 1;
      bucket.credits += Number.isFinite(credits) ? credits : 0;
      creditBundleMap.set(bundleName, bucket);
      totalCreditsSold += Number.isFinite(credits) ? credits : 0;

      return {
        id: transaction?.transactionId || transaction?._id?.toString?.() || '',
        userId,
        userName: user?.name || 'Unknown',
        userHandle: user?.handle || '',
        userEmail: user?.email || '',
        bundleName,
        credits: Number.isFinite(credits) ? credits : 0,
        paymentMethod: transaction?.paymentMethod || 'unknown',
        status: transaction?.status || 'unknown',
        createdAt: readIsoTimestamp(transaction?.createdAt)
      };
    });

    return res.json({
      success: true,
      data: {
        metrics: {
          totalUsers,
          signupsLast30Days,
          openPostReports,
          openUserReports,
          companiesWithSubscriptions: companiesWithSubscriptions.size,
          totalCreditPurchases: creditPurchases.length,
          totalCreditsSold
        },
        reports: mappedReports,
        companySubscriptions: {
          packageBreakdown: Array.from(packageBreakdownMap.entries()).map(([packageName, count]) => ({
            packageName,
            count
          })),
          recent: companySubscriptions
        },
        creditPurchases: {
          bundleBreakdown: Array.from(creditBundleMap.entries()).map(([bundleName, value]) => ({
            bundleName,
            purchases: value.purchases,
            credits: value.credits
          })),
          recent: creditPurchases
        }
      }
    });
  } catch (error) {
    console.error('Error loading owner control overview:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to load control panel overview'
    });
  }
});

router.patch('/reports/:reportId', async (req: Request, res: Response) => {
  try {
    const { reportId } = req.params;
    const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
    const adminNotes = typeof req.body?.adminNotes === 'string' ? req.body.adminNotes.trim().slice(0, 500) : '';
    const reviewer = (req as any).user;

    if (!REPORT_STATUS_VALUES.has(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status value'
      });
    }

    const db = getDB();
    const now = new Date().toISOString();
    const updateResult = await db.collection('reports').updateOne(
      { id: reportId },
      {
        $set: {
          status,
          adminNotes,
          reviewedBy: reviewer?.id || 'admin',
          reviewedByEmail: reviewer?.email || '',
          updatedAt: now
        }
      }
    );

    if (!updateResult.matchedCount) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      });
    }

    const updated = await db.collection('reports').findOne({ id: reportId });
    return res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    console.error('Error updating report status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update report'
    });
  }
});

router.post('/users/:userId/suspend', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const suspended = req.body?.suspended !== false;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';

    const db = getDB();
    const now = new Date().toISOString();
    const updateResult = await db.collection('users').updateOne(
      { id: userId },
      {
        $set: {
          isSuspended: suspended,
          suspensionReason: suspended ? (reason || 'Suspended by owner control panel') : '',
          suspendedAt: suspended ? now : null,
          updatedAt: now
        }
      }
    );

    if (!updateResult.matchedCount) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    return res.json({
      success: true,
      data: {
        userId,
        isSuspended: suspended,
        message: suspended ? isSuspendedMessage(reason) : 'Suspension removed'
      }
    });
  } catch (error) {
    console.error('Error updating suspension state:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update suspension state'
    });
  }
});

router.post('/posts/:postId/hide', async (req: Request, res: Response) => {
  try {
    const { postId } = req.params;
    const hidden = req.body?.hidden !== false;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
    const reviewer = (req as any).user;

    const db = getDB();
    const post = await db.collection('posts').findOne({ id: postId });
    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }

    const now = new Date().toISOString();

    if (hidden) {
      const originalVisibility = typeof post?.visibility === 'string' ? post.visibility : 'public';
      await db.collection('posts').updateOne(
        { id: postId },
        {
          $set: {
            moderationHidden: true,
            moderationHiddenAt: now,
            moderationHiddenBy: reviewer?.id || 'owner-control-token',
            moderationNote: note,
            moderationOriginalVisibility: post?.moderationOriginalVisibility || originalVisibility,
            visibility: 'private',
            updatedAt: now
          }
        }
      );
    } else {
      const restoreVisibility = typeof post?.moderationOriginalVisibility === 'string'
        ? post.moderationOriginalVisibility
        : (typeof post?.visibility === 'string' && post.visibility !== 'private' ? post.visibility : 'public');
      await db.collection('posts').updateOne(
        { id: postId },
        {
          $set: {
            moderationHidden: false,
            visibility: restoreVisibility,
            updatedAt: now
          },
          $unset: {
            moderationHiddenAt: '',
            moderationHiddenBy: '',
            moderationNote: '',
            moderationOriginalVisibility: ''
          }
        } as any
      );
    }

    const updated = await db.collection('posts').findOne({ id: postId });
    return res.json({
      success: true,
      data: {
        id: updated?.id || postId,
        moderationHidden: !!updated?.moderationHidden,
        visibility: updated?.visibility || 'public'
      }
    });
  } catch (error) {
    console.error('Error updating post moderation state:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update post moderation state'
    });
  }
});

export default router;
