"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReportPreviewEmailMessage = void 0;
const htmlUtils_1 = require("../utils/htmlUtils");
const reportPreviewEmailTemplate_1 = require("../templates/reportPreviewEmailTemplate");
const reportPreviewVisualTemplate_1 = require("../templates/reportPreviewVisualTemplate");
const REPORT_EMAIL_MAX_CAMPAIGN_ROWS = 100;
const buildCampaignRowsHtml = (campaignData) => {
    if (!Array.isArray(campaignData) || campaignData.length === 0)
        return '';
    const rows = [];
    for (let index = 0; index < campaignData.length; index += 1) {
        const row = campaignData[index];
        rows.push(`
      <tr>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#0f172a;font-weight:600;">${(0, htmlUtils_1.safeHtmlText)(row.name, 'Untitled Signal')}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#334155;">${(0, htmlUtils_1.safeHtmlText)(row.status, 'active')}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#0f172a;text-align:right;">${Number(row.impressions || 0).toLocaleString()}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#0f172a;text-align:right;">${Number(row.reach || 0).toLocaleString()}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#0f172a;text-align:right;">${Number(row.clicks || 0).toLocaleString()}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#0f172a;text-align:right;">${(0, htmlUtils_1.safeNumber)(row.ctr, 2)}%</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#0f172a;text-align:right;">${Number(row.conversions || 0).toLocaleString()}</td>
      </tr>
    `);
    }
    return rows.join('');
};
const buildTrendSvg = (series) => {
    if (!Array.isArray(series) || series.length < 2)
        return '';
    const width = 560;
    const height = 170;
    const margin = { top: 18, right: 20, bottom: 24, left: 36 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const clean = series.slice(-24).map((point) => ({
        impressions: Number((point === null || point === void 0 ? void 0 : point.impressions) || 0),
        clicks: Number((point === null || point === void 0 ? void 0 : point.clicks) || 0)
    }));
    const maxY = Math.max(1, ...clean.map((point) => point.impressions), ...clean.map((point) => point.clicks));
    const stepX = clean.length > 1 ? chartWidth / (clean.length - 1) : 0;
    const toY = (value) => margin.top + chartHeight - ((value / maxY) * chartHeight);
    const pointsToPolyline = (values) => values
        .map((value, index) => `${Math.round(margin.left + (index * stepX))},${Math.round(toY(value))}`)
        .join(' ');
    const impressionsPath = pointsToPolyline(clean.map((point) => point.impressions));
    const clicksPath = pointsToPolyline(clean.map((point) => point.clicks));
    return (0, reportPreviewVisualTemplate_1.renderReportTrendSvgTemplate)({
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
const buildDistributionBarsHtml = (rows, labelSuffix = 'share') => {
    if (!Array.isArray(rows) || rows.length === 0)
        return '';
    const cleanRows = rows.slice(0, 5).map((row) => ({
        label: (0, htmlUtils_1.safeHtmlText)(row === null || row === void 0 ? void 0 : row.label, 'Unknown'),
        value: Number((row === null || row === void 0 ? void 0 : row.value) || 0),
        share: Number((row === null || row === void 0 ? void 0 : row.share) || 0)
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
const buildFallbackDistributionRows = (campaignData) => {
    const topCampaigns = campaignData.slice(0, 4);
    const totalImpressions = Math.max(1, topCampaigns.reduce((sum, row) => sum + Number((row === null || row === void 0 ? void 0 : row.impressions) || 0), 0));
    return topCampaigns.map((row) => {
        const value = Number((row === null || row === void 0 ? void 0 : row.impressions) || 0);
        return {
            label: (row === null || row === void 0 ? void 0 : row.name) || 'Signal',
            value,
            share: (value / totalImpressions) * 100,
        };
    });
};
const buildReportPreviewVisualRows = (payload, boundedCampaignData) => {
    var _a, _b, _c;
    const fallbackDistributionRows = buildFallbackDistributionRows(boundedCampaignData);
    const hasPlacementBreakdownSource = Array.isArray((_a = payload.visuals) === null || _a === void 0 ? void 0 : _a.placementBreakdown) || Array.isArray(payload.placementBreakdown);
    const visualPlacementRows = Array.isArray((_b = payload.visuals) === null || _b === void 0 ? void 0 : _b.placementBreakdown)
        ? payload.visuals.placementBreakdown
        : (Array.isArray(payload.placementBreakdown) ? payload.placementBreakdown : fallbackDistributionRows);
    const visualContentRows = Array.isArray((_c = payload.visuals) === null || _c === void 0 ? void 0 : _c.contentBreakdown)
        ? payload.visuals.contentBreakdown.map((row) => ({
            label: row === null || row === void 0 ? void 0 : row.label,
            value: Number((row === null || row === void 0 ? void 0 : row.impressions) || 0),
            share: 0,
        }))
        : (Array.isArray(payload.contentBreakdown)
            ? payload.contentBreakdown.map((row) => ({
                label: row === null || row === void 0 ? void 0 : row.label,
                value: Number((row === null || row === void 0 ? void 0 : row.impressions) || 0),
                share: 0,
            }))
            : []);
    return {
        hasPlacementBreakdownSource,
        visualPlacementRows,
        visualContentRows,
    };
};
const buildExecutiveSummaryRowsHtml = (params) => `
  <tr><td style="padding:8px 0;color:#475569;">Reach</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.metricReach}</td></tr>
  <tr><td style="padding:8px 0;color:#475569;">CTR</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.metricCtr}%</td></tr>
  <tr><td style="padding:8px 0;color:#475569;">Clicks</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.metricClicks}</td></tr>
  <tr><td style="padding:8px 0;color:#475569;">Conversions</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.metricConversions}</td></tr>
  <tr><td style="padding:8px 0;color:#475569;">Engagement Rate</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${params.metricEfficiency}%</td></tr>
`;
const buildVisualsSectionHtml = (params) => {
    const { trendSvg, placementBarsHtml, contentBarsHtml, placementSectionTitle } = params;
    if (!trendSvg && !placementBarsHtml && !contentBarsHtml)
        return '';
    return `
    <h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Visual Insights</h3>
    ${trendSvg ? `<div style="margin-bottom:14px;border:1px solid #e2e8f0;border-radius:12px;padding:8px;background:#ffffff;">${trendSvg}</div>` : ''}
    ${(placementBarsHtml || contentBarsHtml) ? `
      <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:14px;">
        ${placementBarsHtml ? `<div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px;background:#ffffff;"><p style="margin:0 0 8px 0;font-size:12px;font-weight:800;letter-spacing:0.04em;color:#475569;text-transform:uppercase;">${(0, htmlUtils_1.safeHtmlText)(placementSectionTitle)}</p>${placementBarsHtml}</div>` : ''}
        ${contentBarsHtml ? `<div style="border:1px solid #e2e8f0;border-radius:12px;padding:10px;background:#ffffff;"><p style="margin:0 0 8px 0;font-size:12px;font-weight:800;letter-spacing:0.04em;color:#475569;text-transform:uppercase;">Content Distribution</p>${contentBarsHtml}</div>` : ''}
      </div>
    ` : ''}
  `;
};
const buildTopSignalsSectionHtml = (topSignals) => {
    if (topSignals.length === 0)
        return '';
    return `<h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Top Signals</h3><ul style="margin:0 0 16px 18px;padding:0;color:#334155;">${topSignals.map((signal) => `<li style="margin-bottom:6px;">${(0, htmlUtils_1.safeHtmlText)(signal.name)} • CTR ${(0, htmlUtils_1.safeNumber)(signal.ctr, 2)}% • Reach ${Number(signal.reach || 0).toLocaleString()}</li>`).join('')}</ul>`;
};
const buildCampaignDataSectionHtml = (params) => {
    if (params.boundedCampaignData.length === 0)
        return '';
    return `<h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Full Campaign Data</h3>${params.campaignDataTruncated ? `<p style="margin:0 0 8px 0;font-size:12px;color:#64748b;">Showing the first ${REPORT_EMAIL_MAX_CAMPAIGN_ROWS.toLocaleString()} signals for stable email delivery.</p>` : ''}<div style="overflow:auto;margin-bottom:16px;"><table style="width:100%;border-collapse:collapse;min-width:640px;"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Signal</th><th style="text-align:left;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Status</th><th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Impressions</th><th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Reach</th><th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Clicks</th><th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">CTR</th><th style="text-align:right;padding:8px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Conversions</th></tr></thead><tbody>${params.campaignRowsHtml}</tbody></table></div>`;
};
const buildRecommendationsSectionHtml = (recommendations) => {
    if (recommendations.length === 0)
        return '';
    return `<h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Recommendations</h3><ul style="margin:0 0 4px 18px;padding:0;color:#334155;">${recommendations.map((item) => `<li style="margin-bottom:6px;">${(0, htmlUtils_1.safeHtmlText)(item)}</li>`).join('')}</ul>`;
};
const buildReportPreviewMetricsModel = (payload) => {
    var _a, _b, _c, _d, _e, _f, _g;
    return ({
        periodLabel: (0, htmlUtils_1.safeText)(payload.periodLabel, 'Last 7 days'),
        periodLabelHtml: (0, htmlUtils_1.safeHtmlText)(payload.periodLabel, 'Last 7 days'),
        scopeLabelHtml: (0, htmlUtils_1.safeHtmlText)(payload.scope, 'all_signals').replace('_', ' '),
        metricReach: Number(((_a = payload.metrics) === null || _a === void 0 ? void 0 : _a.reach) || 0).toLocaleString(),
        metricCtr: (0, htmlUtils_1.safeNumber)((_b = payload.metrics) === null || _b === void 0 ? void 0 : _b.ctr, 2),
        metricClicks: Number(((_c = payload.metrics) === null || _c === void 0 ? void 0 : _c.clicks) || 0).toLocaleString(),
        metricConversions: Number(((_d = payload.metrics) === null || _d === void 0 ? void 0 : _d.conversions) || 0).toLocaleString(),
        metricEfficiency: (0, htmlUtils_1.safeNumber)((_f = (_e = payload.metrics) === null || _e === void 0 ? void 0 : _e.engagementRate) !== null && _f !== void 0 ? _f : (_g = payload.metrics) === null || _g === void 0 ? void 0 : _g.auraEfficiency, 2),
    });
};
const buildReportPreviewCampaignModel = (payload) => {
    const campaignData = Array.isArray(payload.campaignData) ? payload.campaignData : [];
    const boundedCampaignData = campaignData.slice(0, REPORT_EMAIL_MAX_CAMPAIGN_ROWS);
    return {
        boundedCampaignData,
        campaignDataTruncated: campaignData.length > boundedCampaignData.length,
    };
};
const buildReportPreviewVisualModel = (params) => {
    var _a;
    const { payload, boundedCampaignData } = params;
    const visualTrendSeries = Array.isArray((_a = payload.visuals) === null || _a === void 0 ? void 0 : _a.trendSeries)
        ? payload.visuals.trendSeries
        : [];
    const { hasPlacementBreakdownSource, visualPlacementRows, visualContentRows, } = buildReportPreviewVisualRows(payload, boundedCampaignData);
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
const buildReportPreviewSupplementarySections = (params) => {
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
const buildReportPreviewAttachment = (payload) => {
    var _a, _b;
    const deliveryMode = payload.deliveryMode === 'pdf_attachment' ? 'pdf_attachment' : 'inline_email';
    const attachmentName = (0, htmlUtils_1.safeText)((_a = payload.pdfAttachment) === null || _a === void 0 ? void 0 : _a.filename, `aura-scheduled-report-${new Date().toISOString().split('T')[0]}.pdf`);
    const attachmentContent = typeof ((_b = payload.pdfAttachment) === null || _b === void 0 ? void 0 : _b.contentBase64) === 'string'
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
                disposition: 'attachment',
            }
            : null,
    };
};
const buildReportPreviewEmailMessage = (params) => {
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
    const html = (0, reportPreviewEmailTemplate_1.renderReportPreviewEmailTemplate)({
        periodLabelHtml: metrics.periodLabelHtml,
        scopeLabelHtml: metrics.scopeLabelHtml,
        shouldAttachPdf: attachmentState.shouldAttachPdf,
        executiveSummaryRowsHtml,
        visualsSectionHtml: visualSections.visualsSectionHtml,
        topSignalsSectionHtml: supplementarySections.topSignalsSectionHtml,
        campaignDataSectionHtml: supplementarySections.campaignDataSectionHtml,
        recommendationsSectionHtml: supplementarySections.recommendationsSectionHtml,
    });
    const message = {
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
exports.buildReportPreviewEmailMessage = buildReportPreviewEmailMessage;
