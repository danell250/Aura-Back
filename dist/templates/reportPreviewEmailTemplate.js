"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderReportPreviewEmailTemplate = void 0;
const renderReportPreviewEmailTemplate = (params) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #0f172a 0%, #0b1120 70%); color: white; padding: 28px 28px 20px 28px;">
      <p style="margin:0;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#6ee7b7;font-weight:800;">Aura Reports</p>
      <h2 style="margin:10px 0 6px 0;font-size:24px;line-height:1.2;">Scheduled Report Preview</h2>
      <p style="margin:0;color:#cbd5e1;font-size:13px;">${params.periodLabelHtml} • Scope: ${params.scopeLabelHtml}</p>
      ${params.shouldAttachPdf ? '<p style="margin:8px 0 0 0;color:#a7f3d0;font-size:12px;">Full report PDF attached.</p>' : ''}
    </div>
    <div style="padding: 24px 28px;">
      <h3 style="margin:0 0 12px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Executive Summary</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
        ${params.executiveSummaryRowsHtml}
      </table>
      ${params.visualsSectionHtml}
      ${params.topSignalsSectionHtml}
      ${params.campaignDataSectionHtml}
      ${params.recommendationsSectionHtml}
    </div>
  </div>
`;
exports.renderReportPreviewEmailTemplate = renderReportPreviewEmailTemplate;
