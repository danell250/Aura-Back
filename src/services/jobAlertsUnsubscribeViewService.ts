import { readString } from '../utils/inputSanitizers';
import { getPublicWebUrl } from '../utils/publicWebUrl';
import { renderJobAlertStatusTemplate } from '../templates/jobAlertStatusTemplate';

const APP_BASE_URL = getPublicWebUrl();

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const buildJobAlertStatusHtml = (params: {
  title: string;
  body: string;
}): string => {
  const title = escapeHtml(readString(params.title, 160) || 'Aura Jobs');
  const body = escapeHtml(readString(params.body, 640) || 'Aura Jobs');
  const jobsUrl = `${APP_BASE_URL}/jobs`;

  return renderJobAlertStatusTemplate({
    titleHtml: title,
    bodyHtml: body,
    jobsUrl,
  });
};

export const buildJobAlertUnsubscribeConfirmHtml = (params: {
  token: string;
}): string => {
  const token = escapeHtml(readString(params.token, 240) || '');
  const jobsUrl = `${APP_BASE_URL}/jobs`;

  return renderJobAlertStatusTemplate({
    titleHtml: 'Confirm weekly job alert unsubscribe',
    bodyHtml: 'Click confirm to stop receiving Aura weekly job alerts for this email address.',
    jobsUrl,
    actionHtml: `
      <form method="post" action="${APP_BASE_URL}/api/jobs/alerts/unsubscribe" style="margin-top:18px;">
        <input type="hidden" name="token" value="${token}" />
        <button type="submit" style="display:inline-flex;padding:12px 18px;border-radius:12px;text-decoration:none;background:#0f172a;color:#fff;font-weight:700;border:0;cursor:pointer;">
          Confirm unsubscribe
        </button>
      </form>
      <a href="${jobsUrl}" style="display:inline-flex;margin-top:12px;padding:12px 18px;border-radius:12px;text-decoration:none;background:#e2e8f0;color:#0f172a;font-weight:700;">Keep alerts and go back</a>
    `,
  });
};
