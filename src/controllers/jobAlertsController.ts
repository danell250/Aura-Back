import { Request, Response } from 'express';
import { getDB, isDBConnected } from '../db';
import { sendJobAlertsWelcomeEmail } from '../services/jobAlertEmailService';
import { JOB_ALERT_CATEGORIES, normalizeJobAlertCategory } from '../services/jobAlertCategoryService';
import {
  buildJobAlertStatusHtml,
  buildJobAlertUnsubscribeConfirmHtml,
} from '../services/jobAlertsUnsubscribeViewService';
import {
  isValidJobAlertEmail,
  markPublicJobAlertWelcomeEmailSent,
  subscribeToPublicJobAlerts,
  unsubscribePublicJobAlertsByToken,
} from '../services/jobAlertSubscriptionService';
import { getPublicWebUrl } from '../utils/publicWebUrl';
import { readString } from '../utils/inputSanitizers';

const APP_BASE_URL = getPublicWebUrl();

export const jobAlertsController = {
  subscribePublicJobAlerts: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res.status(503).json({ success: false, error: 'Database service unavailable' });
      }

      const email = readString((req.body as any)?.email, 220).toLowerCase();
      const category = normalizeJobAlertCategory((req.body as any)?.category);
      if (!isValidJobAlertEmail(email)) {
        return res.status(400).json({ success: false, error: 'A valid email address is required' });
      }
      if (!JOB_ALERT_CATEGORIES.includes(category)) {
        return res.status(400).json({ success: false, error: 'Invalid category' });
      }

      const db = getDB();
      const result = await subscribeToPublicJobAlerts({
        db,
        email,
        category,
      });

      const unsubscribeUrl = `${APP_BASE_URL}/api/jobs/alerts/unsubscribe?token=${encodeURIComponent(result.unsubscribeToken)}`;
      if (result.status !== 'updated') {
        try {
          await sendJobAlertsWelcomeEmail(email, {
            categoryLabel: category === 'all' ? 'All jobs' : `${category[0].toUpperCase()}${category.slice(1)} jobs`,
            jobsUrl: `${APP_BASE_URL}/jobs`,
            unsubscribeUrl,
          });
          await markPublicJobAlertWelcomeEmailSent({
            db,
            email,
            sentAtIso: new Date().toISOString(),
          });
        } catch (emailError) {
          console.error('Public job alert welcome email error:', emailError);
        }
      }

      const message = result.status === 'created'
        ? 'Weekly job alerts are on. Check your inbox for the welcome email.'
        : result.status === 'reactivated'
          ? 'Weekly job alerts are back on. Check your inbox for the welcome email.'
          : 'You are already on the weekly job alerts list. We refreshed your preferences.';

      return res.status(result.created ? 201 : 200).json({
        success: true,
        data: {
          email,
          category,
          cadence: 'weekly',
        },
        message,
      });
    } catch (error) {
      console.error('Subscribe public job alerts error:', error);
      return res.status(500).json({ success: false, error: 'Failed to subscribe to job alerts' });
    }
  },

  renderPublicJobAlertsUnsubscribeConfirm: async (req: Request, res: Response) => {
    try {
      const token = readString((req.query as any)?.token, 240);
      if (!token) {
        return res
          .status(400)
          .type('html')
          .send(buildJobAlertStatusHtml({
            title: 'Invalid unsubscribe link',
            body: 'That unsubscribe link is incomplete or expired.',
          }));
      }

      return res
        .status(200)
        .type('html')
        .send(buildJobAlertUnsubscribeConfirmHtml({ token }));
    } catch (error) {
      console.error('Render public job alerts unsubscribe confirm error:', error);
      return res
        .status(500)
        .type('html')
        .send(buildJobAlertStatusHtml({
          title: 'Could not load your unsubscribe page',
          body: 'Aura hit an unexpected error while loading your unsubscribe confirmation.',
        }));
    }
  },

  confirmPublicJobAlertsUnsubscribe: async (req: Request, res: Response) => {
    try {
      if (!isDBConnected()) {
        return res
          .status(503)
          .type('html')
          .send(buildJobAlertStatusHtml({
            title: 'Job alerts are temporarily unavailable',
            body: 'Aura could not reach the alerts service right now. Try again later.',
          }));
      }

      const token = readString((req.body as any)?.token || (req.query as any)?.token, 240);
      if (!token) {
        return res
          .status(400)
          .type('html')
          .send(buildJobAlertStatusHtml({
            title: 'Invalid unsubscribe link',
            body: 'That unsubscribe request is incomplete or expired.',
          }));
      }

      const success = await unsubscribePublicJobAlertsByToken({
        db: getDB(),
        token,
      });

      return res
        .status(success ? 200 : 404)
        .type('html')
        .send(buildJobAlertStatusHtml({
          title: success ? 'Weekly job alerts turned off' : 'Alert subscription not found',
          body: success
            ? 'You have been unsubscribed from Aura weekly job alerts.'
            : 'This unsubscribe link is no longer active.',
        }));
    } catch (error) {
      console.error('Unsubscribe public job alerts error:', error);
      return res
        .status(500)
        .type('html')
        .send(buildJobAlertStatusHtml({
          title: 'Could not update your alert subscription',
          body: 'Aura hit an unexpected error while processing your unsubscribe request.',
        }));
    }
  },
};
