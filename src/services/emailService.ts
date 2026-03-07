import sgMail from '@sendgrid/mail';
import { buildReportPreviewEmailMessage, type ReportPreviewEmailPayload } from './reportPreviewEmailPresenterService';
import {
  buildCompanyInviteEmailHtml,
  buildJobApplicationReviewEmailHtml,
  buildMagicLinkEmailHtml,
  buildReverseJobMatchDigestEmailHtml,
  type JobApplicationReviewEmailPayload,
  type ReverseJobDigestItem,
} from './transactionalEmailPresenterService';
import { safeText } from '../utils/htmlUtils';

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

export interface EmailDeliveryResult {
  delivered: boolean;
  provider: 'sendgrid' | 'disabled';
  reason?: string;
}

export const isEmailDeliveryConfigured = () =>
  typeof process.env.SENDGRID_API_KEY === 'string' && process.env.SENDGRID_API_KEY.trim().length > 0;

export const getDefaultEmailFrom = (): string =>
  `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aurasocial.world'}>`;

export const sanitizeEmailSubjectText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
};

export async function sendMagicLinkEmail(to: string, magicLink: string) {
  // Configured as per request: using SENDGRID_FROM_NAME and SENDGRID_FROM_EMAIL
  const from = getDefaultEmailFrom();
  
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('⚠️ SendGrid credentials not found. Magic link will be logged to console only.');
    console.log('--- MAGIC LINK ---');
    console.log(magicLink);
    console.log('------------------');
    return; // Don't throw, just return success (simulated)
  }

  try {
    await sgMail.send({
      to,
      from,
      subject: 'Your secure login link for Aura Social',
      html: buildMagicLinkEmailHtml(magicLink),
    });
    console.log('✓ Magic link email sent via SendGrid to:', to);
  } catch (error: any) {
    console.error('Error sending magic link email:', error);
    if (error.response) {
      console.error(error.response.body);
    }
    throw error;
  }
}

export async function sendCompanyInviteEmail(to: string, companyName: string, inviteUrl: string): Promise<EmailDeliveryResult> {
  const from = getDefaultEmailFrom();
  const subjectCompanyName = sanitizeEmailSubjectText(companyName) || 'Aura Company';
  
  if (!isEmailDeliveryConfigured()) {
    console.warn('⚠️ SendGrid credentials not found. Company invite will be logged to console only.');
    console.log('--- COMPANY INVITE ---');
    console.log(`To: ${to}`);
    console.log(`Company: ${subjectCompanyName}`);
    console.log(`URL: ${inviteUrl}`);
    console.log('----------------------');
    return {
      delivered: false,
      provider: 'disabled',
      reason: 'SENDGRID_API_KEY is not configured'
    };
  }

  try {
    await sgMail.send({
      to,
      from,
      subject: `Invite to join ${subjectCompanyName} on Aura©`,
      html: buildCompanyInviteEmailHtml({
        companyName: subjectCompanyName,
        inviteUrl,
      }),
    });
    console.log('✓ Company invite email sent via SendGrid to:', to);
    return {
      delivered: true,
      provider: 'sendgrid'
    };
  } catch (error: any) {
    console.error('Error sending company invite email:', error);
    throw error;
  }
}

export async function sendReportPreviewEmail(to: string, payload: ReportPreviewEmailPayload): Promise<EmailDeliveryResult> {
  const from = getDefaultEmailFrom();
  const periodLabel = safeText(payload.periodLabel, 'Last 7 days');
  const scopeLabel = safeText(payload.scope, 'all_signals').replace('_', ' ');

  if (!isEmailDeliveryConfigured()) {
    console.warn('⚠️ SendGrid credentials not found. Report preview email will be logged to console only.');
    console.log('--- REPORT PREVIEW EMAIL ---');
    console.log(`To: ${to}`);
    console.log(`Period: ${periodLabel}`);
    console.log(`Scope: ${scopeLabel}`);
    console.log('----------------------------');
    return {
      delivered: false,
      provider: 'disabled',
      reason: 'SENDGRID_API_KEY is not configured'
    };
  }

  try {
    const message = buildReportPreviewEmailMessage({
      to,
      from,
      payload,
    });

    await sgMail.send(message);
    console.log('✓ Report preview email sent via SendGrid to:', to);
    return {
      delivered: true,
      provider: 'sendgrid'
    };
  } catch (error: any) {
    console.error('Error sending report preview email:', error);
    if (error.response) {
      console.error(error.response.body);
    }
    throw error;
  }
}

export async function sendJobApplicationReviewEmail(
  to: string,
  payload: JobApplicationReviewEmailPayload,
): Promise<EmailDeliveryResult> {
  const from = getDefaultEmailFrom();
  const companyName = safeText(payload.companyName, 'Aura Company');
  const jobTitle = safeText(payload.jobTitle, 'Open role');

  if (!isEmailDeliveryConfigured()) {
    console.warn('⚠️ SendGrid credentials not found. Job review email will be logged to console only.');
    console.log('--- JOB REVIEW EMAIL ---');
    console.log(`To: ${to}`);
    console.log(`Company: ${companyName}`);
    console.log(`Role: ${jobTitle}`);
    console.log(`Portal URL: ${payload.securePortalUrl}`);
    console.log('------------------------');
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
      subject: `New job application: ${jobTitle} • ${companyName}`,
      html: buildJobApplicationReviewEmailHtml(payload),
    });

    return {
      delivered: true,
      provider: 'sendgrid',
    };
  } catch (error: any) {
    console.error('Error sending job application review email:', error);
    if (error?.response) {
      console.error(error.response.body);
    }
    throw error;
  }
}

export async function sendReverseJobMatchDigestEmail(
  to: string,
  payload: {
    recipientName: string;
    jobs: ReverseJobDigestItem[];
    shareUrl?: string;
  },
): Promise<EmailDeliveryResult> {
  const from = getDefaultEmailFrom();
  const jobs = Array.isArray(payload.jobs) ? payload.jobs.slice(0, 10) : [];
  const shareUrl = typeof payload.shareUrl === 'string' ? payload.shareUrl.trim() : '';

  if (jobs.length === 0) {
    return { delivered: false, provider: isEmailDeliveryConfigured() ? 'sendgrid' : 'disabled', reason: 'No jobs to send' };
  }

  if (!isEmailDeliveryConfigured()) {
    console.warn('⚠️ SendGrid credentials not found. Reverse match digest email will be logged to console only.');
    console.log('--- REVERSE MATCH DIGEST ---');
    console.log(`To: ${to}`);
    console.log(`Jobs: ${jobs.length}`);
    console.log(`Share URL: ${shareUrl || 'n/a'}`);
    console.log('----------------------------');
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
      subject: `${jobs.length} jobs you're a strong match for today`,
      html: buildReverseJobMatchDigestEmailHtml({
        recipientName: payload.recipientName,
        jobs,
        shareUrl,
      }),
    });
    return { delivered: true, provider: 'sendgrid' };
  } catch (error: any) {
    console.error('Error sending reverse job match digest email:', error);
    if (error?.response) {
      console.error(error.response.body);
    }
    throw error;
  }
}
