import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

export async function sendMagicLinkEmail(to: string, magicLink: string) {
  // Configured as per request: using SENDGRID_FROM_NAME and SENDGRID_FROM_EMAIL
  const from = `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aura.net.za'}>`;
  
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
      subject: 'Your secure login link for Aura©',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Login to Aura©</h2>
          <p>Click the button below to sign in. This link expires in 15 minutes.</p>
          <p>
            <a href="${magicLink}"
               style="display:inline-block;padding:10px 14px;background:#10b981;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
               Sign in to Aura©
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

export async function sendCompanyInviteEmail(to: string, companyName: string, inviteUrl: string) {
  const from = `${process.env.SENDGRID_FROM_NAME || 'Aura©'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aura.net.za'}>`;
  
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('⚠️ SendGrid credentials not found. Company invite will be logged to console only.');
    console.log('--- COMPANY INVITE ---');
    console.log(`To: ${to}`);
    console.log(`Company: ${companyName}`);
    console.log(`URL: ${inviteUrl}`);
    console.log('----------------------');
    return;
  }

  try {
    await sgMail.send({
      to,
      from,
      subject: `Invite to join ${companyName} on Aura©`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px;">
          <h2 style="color: #1e293b; margin-top: 0;">Join ${companyName}</h2>
          <p style="color: #475569; line-height: 1.6;">You've been invited to join the team for <strong>${companyName}</strong> on Aura©.</p>
          <p style="margin: 32px 0;">
            <a href="${inviteUrl}"
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
    spend?: number;
    auraEfficiency?: number;
  };
  topSignals?: Array<{ name?: string; ctr?: number; reach?: number }>;
  recommendations?: string[];
}

const safeText = (value: unknown, fallback = 'N/A') => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return fallback;
};

const safeNumber = (value: unknown, digits = 2) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return Number(0).toFixed(digits);
  return numberValue.toFixed(digits);
};

export async function sendReportPreviewEmail(to: string, payload: ReportPreviewPayload) {
  const from = `${process.env.SENDGRID_REPORTS_FROM_NAME || 'Aura Reports'} <${process.env.SENDGRID_REPORTS_FROM_EMAIL || 'reports@aura.net.za'}>`;

  const metricReach = Number(payload.metrics?.reach || 0).toLocaleString();
  const metricCtr = safeNumber(payload.metrics?.ctr, 2);
  const metricClicks = Number(payload.metrics?.clicks || 0).toLocaleString();
  const metricConversions = Number(payload.metrics?.conversions || 0).toLocaleString();
  const metricEfficiency = safeNumber(payload.metrics?.auraEfficiency, 2);
  const metricSpend = safeNumber(payload.metrics?.spend, 2);
  const periodLabel = safeText(payload.periodLabel, 'Last 7 days');
  const scopeLabel = safeText(payload.scope, 'all_signals').replace('_', ' ');
  const topSignals = Array.isArray(payload.topSignals) ? payload.topSignals.slice(0, 3) : [];
  const recommendations = Array.isArray(payload.recommendations) ? payload.recommendations.slice(0, 3) : [];
  const deliveryMode = payload.deliveryMode === 'pdf_attachment' ? 'pdf_attachment' : 'inline_email';
  const attachmentName = safeText(payload.pdfAttachment?.filename, `aura-scheduled-report-${new Date().toISOString().split('T')[0]}.pdf`);
  const attachmentContent = typeof payload.pdfAttachment?.contentBase64 === 'string'
    ? payload.pdfAttachment.contentBase64.replace(/^data:application\/pdf;base64,/, '').trim()
    : '';
  const shouldAttachPdf = deliveryMode === 'pdf_attachment' && attachmentContent.length > 0;

  if (!process.env.SENDGRID_API_KEY) {
    console.warn('⚠️ SendGrid credentials not found. Report preview email will be logged to console only.');
    console.log('--- REPORT PREVIEW EMAIL ---');
    console.log(`To: ${to}`);
    console.log(`Period: ${periodLabel}`);
    console.log(`Scope: ${scopeLabel}`);
    console.log('----------------------------');
    return;
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
            <p style="margin:0;color:#cbd5e1;font-size:13px;">${periodLabel} • Scope: ${scopeLabel}</p>
            ${shouldAttachPdf ? '<p style="margin:8px 0 0 0;color:#a7f3d0;font-size:12px;">Full report PDF attached.</p>' : ''}
          </div>
          <div style="padding: 24px 28px;">
            <h3 style="margin:0 0 12px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Executive Summary</h3>
            <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
              <tr><td style="padding:8px 0;color:#475569;">Reach</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricReach}</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">CTR</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricCtr}%</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">Clicks</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricClicks}</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">Conversions</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricConversions}</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">Aura Efficiency</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">${metricEfficiency}</td></tr>
              <tr><td style="padding:8px 0;color:#475569;">Spend</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a;">$${metricSpend}</td></tr>
            </table>

            ${topSignals.length > 0 ? `
            <h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Top Signals</h3>
            <ul style="margin:0 0 16px 18px;padding:0;color:#334155;">
              ${topSignals.map((signal) => `<li style="margin-bottom:6px;">${safeText(signal.name)} • CTR ${safeNumber(signal.ctr, 2)}% • Reach ${Number(signal.reach || 0).toLocaleString()}</li>`).join('')}
            </ul>` : ''}

            ${recommendations.length > 0 ? `
            <h3 style="margin:0 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Recommendations</h3>
            <ul style="margin:0 0 4px 18px;padding:0;color:#334155;">
              ${recommendations.map((item) => `<li style="margin-bottom:6px;">${safeText(item)}</li>`).join('')}
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
  } catch (error: any) {
    console.error('Error sending report preview email:', error);
    if (error.response) {
      console.error(error.response.body);
    }
    throw error;
  }
}
