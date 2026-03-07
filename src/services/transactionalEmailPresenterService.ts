import { safeHtmlText, safeText } from '../utils/htmlUtils';
import {
  renderCompanyInviteEmailTemplate,
  renderJobApplicationReviewEmailTemplate,
  renderMagicLinkEmailTemplate,
  renderReverseJobMatchDigestEmailTemplate,
} from '../templates/transactionalEmailTemplates';

export interface JobApplicationReviewEmailPayload {
  reviewerName?: string;
  companyName?: string;
  jobTitle?: string;
  applicantName?: string;
  applicantEmail?: string;
  applicantPhone?: string;
  submittedAt?: string;
  securePortalUrl: string;
  expiresAt?: string;
}

export type ReverseJobDigestItem = {
  title: string;
  companyName: string;
  locationText?: string;
  score: number;
  url: string;
  matchTier?: 'best' | 'good' | 'other';
};

export const buildMagicLinkEmailHtml = (magicLink: string): string =>
  renderMagicLinkEmailTemplate({
    magicLinkHtml: safeHtmlText(magicLink),
  });

export const buildCompanyInviteEmailHtml = (params: {
  companyName: string;
  inviteUrl: string;
}): string =>
  renderCompanyInviteEmailTemplate({
    companyNameHtml: safeHtmlText(params.companyName),
    inviteUrlHtml: safeHtmlText(params.inviteUrl),
  });

export const buildJobApplicationReviewEmailHtml = (payload: JobApplicationReviewEmailPayload): string => {
  const reviewerName = safeText(payload.reviewerName, 'Team');
  const companyName = safeText(payload.companyName, 'Aura Company');
  const jobTitle = safeText(payload.jobTitle, 'Open role');
  const applicantName = safeText(payload.applicantName, 'Applicant');
  const applicantEmail = safeText(payload.applicantEmail, 'Not provided');
  const applicantPhone = safeText(payload.applicantPhone, 'Not provided');
  const submittedAtRaw = safeText(payload.submittedAt, new Date().toISOString());
  const submittedAt = Number.isNaN(new Date(submittedAtRaw).getTime())
    ? submittedAtRaw
    : new Date(submittedAtRaw).toLocaleString();
  const expiresAtRaw = safeText(payload.expiresAt, '');
  const expiresAt = expiresAtRaw && !Number.isNaN(new Date(expiresAtRaw).getTime())
    ? new Date(expiresAtRaw).toLocaleString()
    : expiresAtRaw;

  return renderJobApplicationReviewEmailTemplate({
    reviewerNameHtml: safeHtmlText(reviewerName),
    companyNameHtml: safeHtmlText(companyName),
    jobTitleHtml: safeHtmlText(jobTitle),
    applicantNameHtml: safeHtmlText(applicantName),
    applicantEmailHtml: safeHtmlText(applicantEmail),
    applicantPhoneHtml: safeHtmlText(applicantPhone),
    submittedAtHtml: safeHtmlText(submittedAt),
    expiresRowHtml: expiresAt
      ? `<tr><td style="padding:8px 0;color:#64748b;">Secure link expires</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${safeHtmlText(expiresAt)}</td></tr>`
      : '',
    securePortalUrlHtml: safeHtmlText(payload.securePortalUrl),
  });
};

export const buildReverseJobMatchDigestEmailHtml = (params: {
  recipientName: string;
  jobs: ReverseJobDigestItem[];
  shareUrl?: string;
}): string => {
  const safeRecipientName = safeHtmlText(params.recipientName || 'there');
  const rowsHtml = params.jobs
    .map((job) => {
      const title = safeHtmlText(job.title || 'Job match');
      const companyName = safeHtmlText(job.companyName || 'Hiring Team');
      const locationText = safeHtmlText(job.locationText || 'Flexible');
      const url = safeHtmlText(job.url || '#');
      const score = Math.max(0, Math.round(Number(job.score || 0)));
      return `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;">
            <a href="${url}" style="color:#0f172a;font-weight:700;text-decoration:none;">${title}</a>
            <div style="font-size:12px;color:#475569;margin-top:2px;">${companyName} • ${locationText}</div>
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:800;color:#059669;">
            ${score}%
          </td>
        </tr>
      `;
    })
    .join('');

  const shareUrl = typeof params.shareUrl === 'string' ? params.shareUrl.trim() : '';

  return renderReverseJobMatchDigestEmailTemplate({
    jobsCount: params.jobs.length,
    recipientNameHtml: safeRecipientName,
    rowsHtml,
    shareLinkHtml: shareUrl
      ? `
        <p style="margin:16px 0 0 0;font-size:12px;color:#64748b;">
          Share your top matches:
          <a href="${safeHtmlText(shareUrl)}" style="color:#0f766e;text-decoration:none;font-weight:700;">${safeHtmlText(shareUrl)}</a>
        </p>
      `
      : '',
  });
};
