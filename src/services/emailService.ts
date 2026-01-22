import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

export async function sendMagicLinkEmail(to: string, magicLink: string) {
  const from = process.env.EMAIL_FROM;
  
  // For development without credentials, log the link instead of crashing
  if (!process.env.SENDGRID_API_KEY || !from) {
    console.log('⚠️ SendGrid credentials not found. Skipping email send.');
    if (!process.env.SENDGRID_API_KEY) console.log('   - Missing SENDGRID_API_KEY');
    if (!from) console.log('   - Missing EMAIL_FROM');
    
    console.log(`📨 [MOCK EMAIL] To: ${to}`);
    console.log(`🔗 Magic Link: ${magicLink}`);
    return;
  }

  try {
    await sgMail.send({
      to,
      from,
      subject: 'Your secure login link',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Login to Aura</h2>
          <p>Click the button below to sign in. This link expires in 15 minutes.</p>
          <p>
            <a href="${magicLink}"
               style="display:inline-block;padding:10px 14px;background:#10b981;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
               Sign in to Aura
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
