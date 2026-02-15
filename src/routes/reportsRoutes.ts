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

    const summary = req.body?.summary || {};
    await Promise.all(recipients.map((recipient: string) => sendReportPreviewEmail(recipient, summary)));

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
