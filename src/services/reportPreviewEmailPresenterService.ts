import type { AttachmentData } from '@sendgrid/helpers/classes/attachment';
import type { MailDataRequired } from '@sendgrid/helpers/classes/mail';
import { safeHtmlText, safeNumber, safeText } from '../utils/htmlUtils';
import { renderReportPreviewEmailTemplate } from '../templates/reportPreviewEmailTemplate';
import { renderReportTrendSvgTemplate } from '../templates/reportPreviewVisualTemplate';

export interface ReportPreviewEmailPayload {
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

const REPORT_EMAIL_MAX_CAMPAIGN_ROWS = 100;
const buildCampaignRowsHtml = (
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

  return renderReportTrendSvgTemplate({
    width,
    height,
    marginLeft: margin.left,
    marginTop: margin.top,
    chartWidth,
    chartHeight,
    maxYLabel: Math.round(maxY).toLocaleString(),
    impressionsPath,
    clicksPath,
  });
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

const buildFallbackDistributionRows = (
  campaignData: Array<{ name?: string; impressions?: number }>,
) => {
  const topCampaigns = campaignData.slice(0, 4);
  const totalImpressions = Math.max(
    1,
    topCampaigns.reduce((sum, row) => sum + Number(row?.impressions || 0), 0)
  );

  return topCampaigns.map((row) => {
    const value = Number(row?.impressions || 0);
    return {
      label: row?.name || 'Signal',
      value,
      share: (value / totalImpressions) * 100,
    };
  });
};

const buildReportPreviewVisualRows = (
  payload: ReportPreviewEmailPayload,
  boundedCampaignData: Array<{ name?: string; impressions?: number }>,
) => {
  const fallbackDistributionRows = buildFallbackDistributionRows(boundedCampaignData);
  const hasPlacementBreakdownSource =
    Array.isArray(payload.visuals?.placementBreakdown) || Array.isArray(payload.placementBreakdown);

  const visualPlacementRows = Array.isArray(payload.visuals?.placementBreakdown)
    ? payload.visuals!.placementBreakdown!
    : (Array.isArray(payload.placementBreakdown) ? payload.placementBreakdown : fallbackDistributionRows);

  const visualContentRows = Array.isArray(payload.visuals?.contentBreakdown)
    ? payload.visuals!.contentBreakdown!.map((row) => ({
        label: row?.label,
        value: Number(row?.impressions || 0),
        share: 0,
      }))
    : (Array.isArray(payload.contentBreakdown)
      ? payload.contentBreakdown.map((row) => ({
          label: row?.label,
          value: Number(row?.impressions || 0),
          share: 0,
        }))
      : []);

  return {
    hasPlacementBreakdownSource,
    visualPlacementRows,
    visualContentRows,
  };
};

const buildExecutiveSummaryRowsHtml = (params: {
  metricReach: string;
  metricCtr: string;
  metricClicks: string;
  metricConversions: string;
  metricEfficiency: string;
}): string => `
  <tr><td style="padding:8px 0;color:#475569;">Reach</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.metricReach}</td></tr>
  <tr><td style="padding:8px 0;color:#475569;">CTR</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.metricCtr}%</td></tr>
  <tr><td style="padding:8px 0;color:#475569;">Clicks</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.metricClicks}</td></tr>
  <tr><td style="padding:8px 0;color:#475569;">Conversions</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.metricConversions}</td></tr>
  <tr><td style="padding:8px 0;color:#475569;">Engagement Rate</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.metricEfficiency}%</td></tr>
`;

const buildVisualsSectionHtml = (params: {
  trendSvg: string;
  placementBarsHtml: string;
  contentBarsHtml: string;
  placementSectionTitle: string;
}): string => {
  const { trendSvg, placementBarsHtml, contentBarsHtml, placementSectionTitle } = params;
  if (!trendSvg && !placementBarsHtml && !contentBarsHtml) return '';

  return `
    <h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Visual Insights</h3>
    ${trendSvg ? `<div style="margin-bottom:14px;border:1px solid #e2e8f0;border-radius:12px;padding:8px;background:#ffffff;">${trendSvg}</div>` : ''}
    ${(placementBarsHtml || contentBarsHtml) ? `
      <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:14px;">
        ${placementBarsHtml ? `<div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px;background:#ffffff;"><p style="margin:0 0 8px 0;font-size:12px;font-weight:800;letter-spacing:0.04em;color:#475569;text-transform:uppercase;">${safeHtmlText(placementSectionTitle)}</p>${placementBarsHtml}</div>` : ''}
        ${contentBarsHtml ? `<div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px;background:#ffffff;"><p style="margin:0 0 8px 0;font-size:12px;font-weight:800;letter-spacing:0.04em;color:#475569;text-transform:uppercase;">Content Distribution</p>${contentBarsHtml}</div>` : ''}
      </div>
    ` : ''}
  `;
};

const buildTopSignalsSectionHtml = (
  topSignals: Array<{ name?: string; ctr?: number; reach?: number }>,
): string => {
  if (topSignals.length === 0) return '';

  return `<h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Top Signals</h3><ul style="margin:0 0 16px 18px;padding:0;color:#334155;">${topSignals.map((signal) => `<li style="margin-bottom:6px;">${safeHtmlText(signal.name)} • CTR ${safeNumber(signal.ctr, 2)}% • Reach ${Number(signal.reach || 0).toLocaleString()}</li>`).join('')}</ul>`;
};

const buildCampaignDataSectionHtml = (params: {
  boundedCampaignData: Array<unknown>;
  campaignDataTruncated: boolean;
  campaignRowsHtml: string;
}): string => {
  if (params.boundedCampaignData.length === 0) return '';

  return `<h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Full Campaign Data</h3>${params.campaignDataTruncated ? `<p style="margin:0 0 8px 0;font-size:12px;color:#64748b;">Showing the first ${REPORT_EMAIL_MAX_CAMPAIGN_ROWS.toLocaleString()} signals for stable email delivery.</p>` : ''}<div style="overflow:auto;margin-bottom:16px;"><table style="width:100%;border-collapse:collapse;min-width:640px;"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Signal</th><th style="text-align:left;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Status</th><th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Impressions</th><th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Reach</th><th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Clicks</th><th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">CTR</th><th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Conversions</th></tr></thead><tbody>${params.campaignRowsHtml}</tbody></table></div>`;
};

const buildRecommendationsSectionHtml = (recommendations: string[]): string => {
  if (recommendations.length === 0) return '';
  return `<h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Recommendations</h3><ul style="margin:0 0 4px 18px;padding:0;color:#334155;">${recommendations.map((item) => `<li style="margin-bottom:6px;">${safeHtmlText(item)}</li>`).join('')}</ul>`;
};

const buildReportPreviewMetricsModel = (payload: ReportPreviewEmailPayload) => ({
  periodLabel: safeText(payload.periodLabel, 'Last 7 days'),
  periodLabelHtml: safeHtmlText(payload.periodLabel, 'Last 7 days'),
  scopeLabelHtml: safeHtmlText(payload.scope, 'all_signals').replace('_', ' '),
  metricReach: Number(payload.metrics?.reach || 0).toLocaleString(),
  metricCtr: safeNumber(payload.metrics?.ctr, 2),
  metricClicks: Number(payload.metrics?.clicks || 0).toLocaleString(),
  metricConversions: Number(payload.metrics?.conversions || 0).toLocaleString(),
  metricEfficiency: safeNumber(payload.metrics?.engagementRate ?? payload.metrics?.auraEfficiency, 2),
});

const buildReportPreviewCampaignModel = (payload: ReportPreviewEmailPayload) => {
  const campaignData = Array.isArray(payload.campaignData) ? payload.campaignData : [];
  const boundedCampaignData = campaignData.slice(0, REPORT_EMAIL_MAX_CAMPAIGN_ROWS);
  return {
    boundedCampaignData,
    campaignDataTruncated: campaignData.length > boundedCampaignData.length,
  };
};

const buildReportPreviewVisualModel = (params: {
  payload: ReportPreviewEmailPayload;
  boundedCampaignData: Array<{ name?: string; impressions?: number }>;
}) => {
  const { payload, boundedCampaignData } = params;
  const visualTrendSeries = Array.isArray(payload.visuals?.trendSeries)
    ? payload.visuals.trendSeries
    : [];
  const {
    hasPlacementBreakdownSource,
    visualPlacementRows,
    visualContentRows,
  } = buildReportPreviewVisualRows(payload, boundedCampaignData);
  const trendSvg = buildTrendSvg(visualTrendSeries);
  const placementBarsHtml = buildDistributionBarsHtml(visualPlacementRows, 'share');
  const contentBarsHtml = buildDistributionBarsHtml(visualContentRows, 'value');
  const placementSectionTitle = hasPlacementBreakdownSource ? 'Placement Distribution' : 'Campaign Distribution';

  return {
    visualsSectionHtml: buildVisualsSectionHtml({
      trendSvg,
      placementBarsHtml,
      contentBarsHtml,
      placementSectionTitle,
    }),
  };
};

const buildReportPreviewSupplementarySections = (params: {
  payload: ReportPreviewEmailPayload;
  boundedCampaignData: Array<{ name?: string; impressions?: number }>;
  campaignDataTruncated: boolean;
}) => {
  const { payload, boundedCampaignData, campaignDataTruncated } = params;
  const topSignals = Array.isArray(payload.topSignals) ? payload.topSignals.slice(0, 5) : [];
  const recommendations = Array.isArray(payload.recommendations) ? payload.recommendations.slice(0, 3) : [];
  const campaignRowsHtml = buildCampaignRowsHtml(boundedCampaignData);

  return {
    topSignalsSectionHtml: buildTopSignalsSectionHtml(topSignals),
    campaignDataSectionHtml: buildCampaignDataSectionHtml({
      boundedCampaignData,
      campaignDataTruncated,
      campaignRowsHtml,
    }),
    recommendationsSectionHtml: buildRecommendationsSectionHtml(recommendations),
  };
};

const buildReportPreviewAttachment = (payload: ReportPreviewEmailPayload): {
  shouldAttachPdf: boolean;
  attachment: AttachmentData | null;
} => {
  const deliveryMode = payload.deliveryMode === 'pdf_attachment' ? 'pdf_attachment' : 'inline_email';
  const attachmentName = safeText(payload.pdfAttachment?.filename, `aura-scheduled-report-${new Date().toISOString().split('T')[0]}.pdf`);
  const attachmentContent = typeof payload.pdfAttachment?.contentBase64 === 'string'
    ? payload.pdfAttachment.contentBase64.replace(/^data:application\/pdf;base64,/, '').trim()
    : '';
  const shouldAttachPdf = deliveryMode === 'pdf_attachment' && attachmentContent.length > 0;

  return {
    shouldAttachPdf,
    attachment: shouldAttachPdf
      ? {
          content: attachmentContent,
          filename: attachmentName,
          type: 'application/pdf',
          disposition: 'attachment' as const,
        }
      : null,
  };
};

export const buildReportPreviewEmailMessage = (params: {
  to: string;
  from: string;
  payload: ReportPreviewEmailPayload;
}): MailDataRequired => {
  const metrics = buildReportPreviewMetricsModel(params.payload);
  const campaign = buildReportPreviewCampaignModel(params.payload);
  const visualSections = buildReportPreviewVisualModel({
    payload: params.payload,
    boundedCampaignData: campaign.boundedCampaignData,
  });
  const supplementarySections = buildReportPreviewSupplementarySections({
    payload: params.payload,
    boundedCampaignData: campaign.boundedCampaignData,
    campaignDataTruncated: campaign.campaignDataTruncated,
  });
  const attachmentState = buildReportPreviewAttachment(params.payload);

  const executiveSummaryRowsHtml = buildExecutiveSummaryRowsHtml({
    metricReach: metrics.metricReach,
    metricCtr: metrics.metricCtr,
    metricClicks: metrics.metricClicks,
    metricConversions: metrics.metricConversions,
    metricEfficiency: metrics.metricEfficiency,
  });

  const html = renderReportPreviewEmailTemplate({
    periodLabelHtml: metrics.periodLabelHtml,
    scopeLabelHtml: metrics.scopeLabelHtml,
    shouldAttachPdf: attachmentState.shouldAttachPdf,
    executiveSummaryRowsHtml,
    visualsSectionHtml: visualSections.visualsSectionHtml,
    topSignalsSectionHtml: supplementarySections.topSignalsSectionHtml,
    campaignDataSectionHtml: supplementarySections.campaignDataSectionHtml,
    recommendationsSectionHtml: supplementarySections.recommendationsSectionHtml,
  });

  const message: MailDataRequired = {
    to: params.to,
    from: params.from,
    subject: `Aura Scheduled Report Preview • ${metrics.periodLabel}`,
    html,
  };

  if (attachmentState.attachment) {
    message.attachments = [attachmentState.attachment];
  }

  return message;
};
