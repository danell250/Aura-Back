import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

export async function sendMagicLinkEmail(to: string, magicLink: string) {
  // Configured as per request: using SENDGRID_FROM_NAME and SENDGRID_FROM_EMAIL
  const from = `${process.env.SENDGRID_FROM_NAME || 'Aura'} <${process.env.SENDGRID_FROM_EMAIL || 'no-reply@aura.net.za'}>`;
  
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
      subject: 'Your secure login link for Aura',
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
