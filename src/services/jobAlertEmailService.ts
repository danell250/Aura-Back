import sgMail from '@sendgrid/mail';
import {
  buildJobAlertDigestEmailHtml,
  buildJobAlertsWelcomeEmailHtml,
  type JobAlertEmailDigestItem,
} from './jobAlertEmailPresenterService';
import {
  getDefaultEmailFrom,
  isEmailDeliveryConfigured,
  sanitizeEmailSubjectText,
  type EmailDeliveryResult,
} from './emailService';

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

export async function sendJobAlertsWelcomeEmail(
  to: string,
  payload: {
    categoryLabel: string;
    jobsUrl: string;
    unsubscribeUrl?: string;
  },
): Promise<EmailDeliveryResult> {
  const from = getDefaultEmailFrom();

  if (!isEmailDeliveryConfigured()) {
    console.warn('⚠️ SendGrid credentials not found. Job alerts welcome email will be logged to console only.');
    console.log('--- JOB ALERT WELCOME ---');
    console.log(`To: ${to}`);
    console.log(`Category: ${payload.categoryLabel}`);
    console.log(`Jobs URL: ${payload.jobsUrl}`);
    console.log('-------------------------');
    return {
      delivered: false,
      provider: 'disabled',
      reason: 'SENDGRID_API_KEY is not configured',
    };
  }

  try {
    await sgMail.send({
      to,
      from,
      subject: 'You are on the Aura weekly job alerts list',
      html: buildJobAlertsWelcomeEmailHtml(payload),
    });
    return { delivered: true, provider: 'sendgrid' };
  } catch (error: any) {
    console.error('Error sending job alerts welcome email:', error);
    if (error?.response) {
      console.error(error.response.body);
    }
    throw error;
  }
}

export async function sendJobAlertDigestEmail(
  to: string,
  payload: {
    recipientName: string;
    headline: string;
    subheadline: string;
    jobs: JobAlertEmailDigestItem[];
    ctaUrl: string;
    ctaLabel: string;
    manageUrl?: string;
  },
): Promise<EmailDeliveryResult> {
  const from = getDefaultEmailFrom();
  const jobs = Array.isArray(payload.jobs) ? payload.jobs.slice(0, 10) : [];

  if (jobs.length === 0) {
    return {
      delivered: false,
      provider: isEmailDeliveryConfigured() ? 'sendgrid' : 'disabled',
      reason: 'No jobs to send',
    };
  }

  if (!isEmailDeliveryConfigured()) {
    console.warn('⚠️ SendGrid credentials not found. Job alert digest email will be logged to console only.');
    console.log('--- JOB ALERT DIGEST ---');
    console.log(`To: ${to}`);
    console.log(`Jobs: ${jobs.length}`);
    console.log(`CTA: ${payload.ctaUrl}`);
    console.log('------------------------');
    return {
      delivered: false,
      provider: 'disabled',
      reason: 'SENDGRID_API_KEY is not configured',
    };
  }

  const html = buildJobAlertDigestEmailHtml({
    recipientName: payload.recipientName,
    headline: payload.headline,
    subheadline: payload.subheadline,
    jobs,
    ctaUrl: payload.ctaUrl,
    ctaLabel: payload.ctaLabel,
    manageUrl: payload.manageUrl,
  });

  try {
    await sgMail.send({
      to,
      from,
      subject: sanitizeEmailSubjectText(payload.headline || 'New jobs on Aura'),
      html,
    });

    return { delivered: true, provider: 'sendgrid' };
  } catch (error: any) {
    console.error('Error sending job alert digest email:', error);
    if (error?.response) {
      console.error(error.response.body);
    }
    throw error;
  }
}
