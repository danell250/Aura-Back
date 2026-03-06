import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

export interface EmailDeliveryResult {
  delivered: boolean;
  provider: 'sendgrid' | 'disabled';
  reason?: string;
}

export const isEmailDeliveryConfigured = () =>
  typeof process.env.SENDGRID_API_KEY === 'string' && process.env.SENDGRID_API_KEY.trim().length > 0;

const sanitizeEmailSubjectText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
};

const escapeEmailHtmlText = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export async function sendMagicLinkEmail(to: string, magicLink: string) {
  // Configured as per request: using SENDGRID_FROM_NAME and SENDGRID_FROM_EMAIL
  const from = `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aurasocila.world'}>`;
  
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
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Login to Aura Social</h2>
          <p>Click the button below to sign in. This link expires in 15 minutes.</p>
          <p>
            <a href="${magicLink}"
               style="display:inline-block;padding:10px 14px;background:#10b981;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
               Sign in to Aura Social
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">If you didn’t request this, you can safely ignore this email.</p>
        </div>
      `,
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
  const from = `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aurasocila.world'}>`;
  const subjectCompanyName = sanitizeEmailSubjectText(companyName) || 'Aura Company';
  const htmlCompanyName = escapeEmailHtmlText(subjectCompanyName);
  const htmlInviteUrl = escapeEmailHtmlText(inviteUrl);
  
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
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px;">
          <h2 style="color: #1e293b; margin-top: 0;">Join ${htmlCompanyName}</h2>
          <p style="color: #475569; line-height: 1.6;">You've been invited to join the team for <strong>${htmlCompanyName}</strong> on Aura©.</p>
          <p style="margin: 32px 0;">
            <a href="${htmlInviteUrl}"
               style="display:inline-block;padding:12px 24px;background:#10b981;color:#fff;border-radius:12px;text-decoration:none;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;font-size:14px;">
               Accept Invitation
            </a>
          </p>
          <p style="color: #64748b; font-size: 12px;">This invitation link will expire in 7 days.</p>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 32px 0;" />
          <p style="color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; text-align: center;">
            Aura© &bull; The New Social Standard
          </p>
        </div>
      `,
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

interface ReportPreviewPayload {
  periodLabel?: string;
  scope?: string;
  deliveryMode?: 'inline_email' | 'pdf_attachment';
  pdfAttachment?: {
    filename?: string;
    contentBase64?: string;
  };
  metrics?: {
    reach?: number;
    ctr?: number;
    clicks?: number;
    conversions?: number;
    auraEfficiency?: number;
    engagementRate?: number;
  };
  placementBreakdown?: Array<{ label?: string; value?: number; share?: number }>;
  contentBreakdown?: Array<{ label?: string; impressions?: number }>;
  campaignData?: Array<{
    name?: string;
    status?: string;
    impressions?: number;
    reach?: number;
    clicks?: number;
    ctr?: number;
    conversions?: number;
    lastUpdated?: number | string;
  }>;
  topSignals?: Array<{ name?: string; ctr?: number; reach?: number }>;
  visuals?: {
    trendSeries?: Array<{ date?: string; impressions?: number; clicks?: number; isProjection?: boolean }>;
    placementBreakdown?: Array<{ label?: string; value?: number; share?: number }>;
    contentBreakdown?: Array<{ label?: string; impressions?: number }>;
    topSignals?: Array<{ name?: string; ctr?: number; reach?: number; impressions?: number; clicks?: number }>;
  };
  recommendations?: string[];
}

const safeText = (value: unknown, fallback = 'N/A') => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return fallback;
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const safeHtmlText = (value: unknown, fallback = 'N/A') => escapeHtml(safeText(value, fallback));

const safeNumber = (value: unknown, digits = 2) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return Number(0).toFixed(digits);
  return numberValue.toFixed(digits);
};

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

const buildCampaignRowsHtml = async (
  campaignData: Array<{
    name?: string;
    status?: string;
    impressions?: number;
    reach?: number;
    clicks?: number;
    ctr?: number;
    conversions?: number;
  }>
) => {
  if (!Array.isArray(campaignData) || campaignData.length === 0) return '';
  const rows: string[] = [];
  for (let index = 0; index < campaignData.length; index += 1) {
    const row = campaignData[index];
    rows.push(`
      <tr>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#0f172a;font-weight:600;">${safeHtmlText(row.name, 'Untitled Signal')}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#334155;">${safeHtmlText(row.status, 'active')}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#0f172a;text-align:right;">${Number(row.impressions || 0).toLocaleString()}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#0f172a;text-align:right;">${Number(row.reach || 0).toLocaleString()}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#0f172a;text-align:right;">${Number(row.clicks || 0).toLocaleString()}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#0f172a;text-align:right;">${safeNumber(row.ctr, 2)}%</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#0f172a;text-align:right;">${Number(row.conversions || 0).toLocaleString()}</td>
      </tr>
    `);

    if ((index + 1) % 250 === 0) {
      await yieldToEventLoop();
    }
  }
  return rows.join('');
};

const buildTrendSvg = (
  series: Array<{ date?: string; impressions?: number; clicks?: number }>
) => {
  if (!Array.isArray(series) || series.length < 2) return '';

  const width = 560;
  const height = 170;
  const margin = { top: 18, right: 20, bottom: 24, left: 36 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const clean = series.slice(-24).map((point) => ({
    impressions: Number(point?.impressions || 0),
    clicks: Number(point?.clicks || 0)
  }));
  const maxY = Math.max(
    1,
    ...clean.map((point) => point.impressions),
    ...clean.map((point) => point.clicks)
  );
  const stepX = clean.length > 1 ? chartWidth / (clean.length - 1) : 0;
  const toY = (value: number) => margin.top + chartHeight - ((value / maxY) * chartHeight);

  const pointsToPolyline = (values: number[]) =>
    values
      .map((value, index) => `${Math.round(margin.left + (index * stepX))},${Math.round(toY(value))}`)
      .join(' ');

  const impressionsPath = pointsToPolyline(clean.map((point) => point.impressions));
  const clicksPath = pointsToPolyline(clean.map((point) => point.clicks));

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Impressions and clicks trend">
      <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
      <line x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}" stroke="#cbd5e1" stroke-width="1" />
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}" stroke="#cbd5e1" stroke-width="1" />
      <polyline points="${impressionsPath}" fill="none" stroke="#059669" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      <polyline points="${clicksPath}" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      <text x="${margin.left}" y="14" font-size="11" fill="#475569" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
        Max ${Math.round(maxY).toLocaleString()}
      </text>
      <text x="${width - 94}" y="14" font-size="11" fill="#059669" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
        ● Impressions
      </text>
      <text x="${width - 94}" y="30" font-size="11" fill="#10b981" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
        ● Clicks
      </text>
    </svg>
  `;
};

const buildDistributionBarsHtml = (
  rows: Array<{ label?: string; value?: number; share?: number }>,
  labelSuffix: 'share' | 'value' = 'share'
) => {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const cleanRows = rows.slice(0, 5).map((row) => ({
    label: safeHtmlText(row?.label, 'Unknown'),
    value: Number(row?.value || 0),
    share: Number(row?.share || 0)
  }));
  const maxValue = Math.max(1, ...cleanRows.map((row) => row.value));

  return cleanRows.map((row) => {
    const widthPercent = Math.max(2, Math.round((row.value / maxValue) * 100));
    const valueLabel = labelSuffix === 'share'
      ? `${row.share.toFixed(1)}%`
      : row.value.toLocaleString();
    return `
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;color:#334155;margin-bottom:4px;">
          <span style="font-weight:600;">${row.label}</span>
          <span style="font-weight:700;">${valueLabel}</span>
        </div>
        <div style="height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden;">
          <div style="height:100%;width:${widthPercent}%;background:linear-gradient(90deg,#10b981,#14b8a6);border-radius:999px;"></div>
        </div>
      </div>
    `;
  }).join('');
};

const REPORT_EMAIL_MAX_CAMPAIGN_ROWS = 10000;

export async function sendReportPreviewEmail(to: string, payload: ReportPreviewPayload): Promise<EmailDeliveryResult> {
  const from = `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aurasocila.world'}>`;

  const metricReach = Number(payload.metrics?.reach || 0).toLocaleString();
  const metricCtr = safeNumber(payload.metrics?.ctr, 2);
  const metricClicks = Number(payload.metrics?.clicks || 0).toLocaleString();
  const metricConversions = Number(payload.metrics?.conversions || 0).toLocaleString();
  const metricEfficiency = safeNumber(payload.metrics?.engagementRate ?? payload.metrics?.auraEfficiency, 2);
  const periodLabel = safeText(payload.periodLabel, 'Last 7 days');
  const periodLabelHtml = safeHtmlText(payload.periodLabel, 'Last 7 days');
  const scopeLabel = safeText(payload.scope, 'all_signals').replace('_', ' ');
  const scopeLabelHtml = safeHtmlText(payload.scope, 'all_signals').replace('_', ' ');
  const topSignals = Array.isArray(payload.topSignals) ? payload.topSignals.slice(0, 5) : [];
  const campaignData = Array.isArray(payload.campaignData) ? payload.campaignData : [];
  const boundedCampaignData = campaignData.slice(0, REPORT_EMAIL_MAX_CAMPAIGN_ROWS);
  const campaignDataTruncated = campaignData.length > boundedCampaignData.length;
  const visualTrendSeries = Array.isArray(payload.visuals?.trendSeries)
    ? payload.visuals!.trendSeries!
    : [];
  const hasPlacementBreakdownSource =
    Array.isArray(payload.visuals?.placementBreakdown) || Array.isArray(payload.placementBreakdown);
  const fallbackDistributionRows = (() => {
    const topCampaigns = boundedCampaignData.slice(0, 4);
    const totalImpressions = Math.max(
      1,
      topCampaigns.reduce((sum, row) => sum + Number(row?.impressions || 0), 0)
    );
    return topCampaigns.map((row) => {
      const value = Number(row?.impressions || 0);
      return {
        label: row?.name || 'Signal',
        value,
        share: (value / totalImpressions) * 100
      };
    });
  })();
  const visualPlacementRows = Array.isArray(payload.visuals?.placementBreakdown)
    ? payload.visuals!.placementBreakdown!
    : (Array.isArray(payload.placementBreakdown) ? payload.placementBreakdown : fallbackDistributionRows);
  const visualContentRows = Array.isArray(payload.visuals?.contentBreakdown)
    ? payload.visuals!.contentBreakdown!.map((row) => ({
        label: row?.label,
        value: Number(row?.impressions || 0),
        share: 0
      }))
    : (Array.isArray(payload.contentBreakdown)
      ? payload.contentBreakdown.map((row) => ({
          label: row?.label,
          value: Number(row?.impressions || 0),
          share: 0
        }))
      : []);
  const trendSvg = buildTrendSvg(visualTrendSeries);
  const placementBarsHtml = buildDistributionBarsHtml(visualPlacementRows, 'share');
  const contentBarsHtml = buildDistributionBarsHtml(visualContentRows, 'value');
  const placementSectionTitle = hasPlacementBreakdownSource ? 'Placement Distribution' : 'Campaign Distribution';
  const recommendations = Array.isArray(payload.recommendations) ? payload.recommendations.slice(0, 3) : [];
  const campaignRowsHtml = await buildCampaignRowsHtml(boundedCampaignData);
  const deliveryMode = payload.deliveryMode === 'pdf_attachment' ? 'pdf_attachment' : 'inline_email';
  const attachmentName = safeText(payload.pdfAttachment?.filename, `aura-scheduled-report-${new Date().toISOString().split('T')[0]}.pdf`);
  const attachmentContent = typeof payload.pdfAttachment?.contentBase64 === 'string'
    ? payload.pdfAttachment.contentBase64.replace(/^data:application\/pdf;base64,/, '').trim()
    : '';
  const shouldAttachPdf = deliveryMode === 'pdf_attachment' && attachmentContent.length > 0;

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
    const message: any = {
      to,
      from,
      subject: `Aura Scheduled Report Preview • ${periodLabel}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #0b1120 70%); color: white; padding: 28px 28px 20px 28px;">
            <p style="margin:0;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#6ee7b7;font-weight:800;">Aura Reports</p>
            <h2 style="margin:10px 0 6px 0;font-size:24px;line-height:1.2;">Scheduled Report Preview</h2>
            <p style="margin:0;color:#cbd5e1;font-size:13px;">${periodLabelHtml} • Scope: ${scopeLabelHtml}</p>
            ${shouldAttachPdf ? '<p style="margin:8px 0 0 0;color:#a7f3d0;font-size:12px;">Full report PDF attached.</p>' : ''}
          </div>
          <div style="padding: 24px 28px;">
            <h3 style="margin:0 0 12px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Executive Summary</h3>
            <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
              <tr><td style="padding:8px 0;color:#475569;">Reach</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricReach}</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">CTR</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricCtr}%</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">Clicks</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricClicks}</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">Conversions</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricConversions}</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">Engagement Rate</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricEfficiency}%</td></tr>
            </table>

            ${(trendSvg || placementBarsHtml || contentBarsHtml) ? `
            <h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Visual Insights</h3>
            ${trendSvg ? `
              <div style="margin-bottom:14px;border:1px solid #e2e8f0;border-radius:12px;padding:8px;background:#ffffff;">
                ${trendSvg}
              </div>
            ` : ''}
            ${(placementBarsHtml || contentBarsHtml) ? `
              <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:14px;">
                ${placementBarsHtml ? `
                  <div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px;background:#ffffff;">
                    <p style="margin:0 0 8px 0;font-size:12px;font-weight:800;letter-spacing:0.04em;color:#475569;text-transform:uppercase;">${safeHtmlText(placementSectionTitle)}</p>
                    ${placementBarsHtml}
                  </div>
                ` : ''}
                ${contentBarsHtml ? `
                  <div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px;background:#ffffff;">
                    <p style="margin:0 0 8px 0;font-size:12px;font-weight:800;letter-spacing:0.04em;color:#475569;text-transform:uppercase;">Content Distribution</p>
                    ${contentBarsHtml}
                  </div>
                ` : ''}
              </div>
            ` : ''}
            ` : ''}

            ${topSignals.length > 0 ? `
            <h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Top Signals</h3>
            <ul style="margin:0 0 16px 18px;padding:0;color:#334155;">
              ${topSignals.map((signal) => `<li style="margin-bottom:6px;">${safeHtmlText(signal.name)} • CTR ${safeNumber(signal.ctr, 2)}% • Reach ${Number(signal.reach || 0).toLocaleString()}</li>`).join('')}
            </ul>` : ''}

            ${boundedCampaignData.length > 0 ? `
            <h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Full Campaign Data</h3>
            ${campaignDataTruncated ? `<p style="margin:0 0 8px 0;font-size:12px;color:#64748b;">Showing the first ${REPORT_EMAIL_MAX_CAMPAIGN_ROWS.toLocaleString()} signals for stable email delivery.</p>` : ''}
            <div style="overflow:auto;margin-bottom:16px;">
              <table style="width:100%;border-collapse:collapse;min-width:640px;">
                <thead>
                  <tr>
                    <th style="text-align:left;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Signal</th>
                    <th style="text-align:left;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Status</th>
                    <th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Impressions</th>
                    <th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Reach</th>
                    <th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Clicks</th>
                    <th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">CTR</th>
                    <th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Conversions</th>
                  </tr>
                </thead>
                <tbody>
                  ${campaignRowsHtml}
                </tbody>
              </table>
            </div>` : ''}

            ${recommendations.length > 0 ? `
            <h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Recommendations</h3>
            <ul style="margin:0 0 4px 18px;padding:0;color:#334155;">
              ${recommendations.map((item) => `<li style="margin-bottom:6px;">${safeHtmlText(item)}</li>`).join('')}
            </ul>` : ''}
          </div>
        </div>
      `
    };

    if (shouldAttachPdf) {
      message.attachments = [
        {
          content: attachmentContent,
          filename: attachmentName,
          type: 'application/pdf',
          disposition: 'attachment'
        }
      ];
    }

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

interface JobApplicationReviewEmailPayload {
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

export async function sendJobApplicationReviewEmail(
  to: string,
  payload: JobApplicationReviewEmailPayload,
): Promise<EmailDeliveryResult> {
  const from = `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aurasocila.world'}>`;

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
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #0b1120 70%); color: #fff; padding: 24px 26px;">
            <p style="margin:0;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#6ee7b7;font-weight:800;">Aura Hiring</p>
            <h2 style="margin:10px 0 6px 0;font-size:22px;line-height:1.25;">New application requires review</h2>
            <p style="margin:0;color:#cbd5e1;font-size:13px;">${companyName} • ${jobTitle}</p>
          </div>
          <div style="padding: 22px 26px;">
            <p style="margin:0 0 14px 0;color:#334155;font-size:14px;">Hi ${reviewerName}, a new candidate applied and is ready for review in the secure portal.</p>
            <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
              <tr><td style="padding:8px 0;color:#64748b;">Applicant</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${applicantName}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;">Email</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${applicantEmail}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;">Phone</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${applicantPhone}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;">Submitted</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${submittedAt}</td></tr>
              ${expiresAt ? `<tr><td style="padding:8px 0;color:#64748b;">Secure link expires</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${expiresAt}</td></tr>` : ''}
            </table>

            <p style="margin: 18px 0 0 0;">
              <a href="${payload.securePortalUrl}"
                 style="display:inline-block;padding:12px 20px;background:#10b981;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:13px;">
                 Review In Secure Portal
              </a>
            </p>

            <p style="margin:14px 0 0 0;color:#64748b;font-size:12px;">This secure link opens your company application review workflow. Access still requires a valid owner/admin session.</p>
          </div>
        </div>
      `,
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

type ReverseJobDigestItem = {
  title: string;
  companyName: string;
  locationText?: string;
  score: number;
  url: string;
  matchTier?: 'best' | 'good' | 'other';
};

export async function sendReverseJobMatchDigestEmail(
  to: string,
  payload: {
    recipientName: string;
    jobs: ReverseJobDigestItem[];
    shareUrl?: string;
  },
): Promise<EmailDeliveryResult> {
  const from = `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aurasocila.world'}>`;
  const safeRecipientName = safeHtmlText(payload.recipientName || 'there');
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

  const rowsHtml = jobs
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

  try {
    await sgMail.send({
      to,
      from,
      subject: `${jobs.length} jobs you're a strong match for today`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;margin:0 auto;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#0f172a 0%,#052e2b 100%);padding:24px;color:#fff;">
            <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#86efac;font-weight:800;">Aura Reverse Match</p>
            <h2 style="margin:10px 0 6px 0;font-size:22px;line-height:1.25;">${jobs.length} jobs match your profile</h2>
            <p style="margin:0;color:#cbd5e1;font-size:13px;">Hi ${safeRecipientName}, these opportunities were discovered and scored for your profile.</p>
          </div>
          <div style="padding:22px 24px;">
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:0 8px 8px 8px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Role</th>
                  <th style="text-align:right;padding:0 8px 8px 8px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Match</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
            ${shareUrl ? `
              <p style="margin:16px 0 0 0;font-size:12px;color:#64748b;">
                Share your top matches:
                <a href="${safeHtmlText(shareUrl)}" style="color:#0f766e;text-decoration:none;font-weight:700;">${safeHtmlText(shareUrl)}</a>
              </p>
            ` : ''}
          </div>
        </div>
      `,
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
