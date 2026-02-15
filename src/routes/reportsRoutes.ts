import { Router } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { sendReportPreviewEmail } from '../services/emailService';

const router = Router();

router.post('/preview-email', requireAuth, async (req, res) => {
  try {
    const actor = (req as any).user;
    if (!actor?.id) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const recipientsRaw = req.body?.recipients;
    if (!Array.isArray(recipientsRaw) || recipientsRaw.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one recipient is required' });
    }

    const recipients = recipientsRaw
      .map((entry: unknown) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
      .filter((entry: string) => entry.length > 0)
      .slice(0, 5);

    if (recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid recipients found' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (recipients.some((entry: string) => !emailRegex.test(entry))) {
      return res.status(400).json({ success: false, error: 'One or more recipients are invalid' });
    }

    const summary = typeof req.body?.summary === 'object' && req.body?.summary ? req.body.summary : {};
    const deliveryMode = req.body?.deliveryMode === 'pdf_attachment' ? 'pdf_attachment' : 'inline_email';

    let pdfAttachment: { filename?: string; contentBase64?: string } | undefined;
    const rawAttachment = req.body?.pdfAttachment;
    if (rawAttachment && typeof rawAttachment === 'object') {
      const filename = typeof rawAttachment.filename === 'string' ? rawAttachment.filename.trim() : '';
      const contentBase64 = typeof rawAttachment.contentBase64 === 'string' ? rawAttachment.contentBase64.trim() : '';
      if (contentBase64.length > 0) {
        const normalizedBase64 = contentBase64.replace(/^data:application\/pdf;base64,/, '');
        if (normalizedBase64.length > 8_000_000) {
          return res.status(400).json({ success: false, error: 'PDF attachment is too large' });
        }
        pdfAttachment = {
          filename: filename || 'aura-scheduled-report.pdf',
          contentBase64: normalizedBase64
        };
      }
    }

    const payload = {
      ...summary,
      deliveryMode,
      ...(pdfAttachment ? { pdfAttachment } : {})
    };

    await Promise.all(recipients.map((recipient: string) => sendReportPreviewEmail(recipient, payload)));

    return res.json({
      success: true,
      sentTo: recipients.length
    });
  } catch (error: any) {
    console.error('Error sending report preview email:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send report preview email'
    });
  }
});

export default router;
