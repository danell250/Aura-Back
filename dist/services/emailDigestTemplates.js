"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildNotificationActionDigestTemplate = exports.buildWeeklyPulseDigestTemplate = void 0;
const escapeHtml = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const sanitizeUrl = (value) => {
    if (!value)
        return '#';
    const trimmed = value.trim();
    if (/^https?:\/\/[^\s]+$/i.test(trimmed)) {
        return trimmed;
    }
    return '#';
};
const toCount = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0)
        return 0;
    return Math.floor(parsed);
};
const renderBaseStyles = () => `
  <style>
    body, table, td, p, a { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .container { width: 100%; max-width: 640px; margin: 0 auto; }
    .card { border: 1px solid #dbe5ef; border-radius: 16px; background: #ffffff; }
    .inner-card { border: 1px solid #dbe5ef; border-radius: 12px; background: #ffffff; }
    .muted { color: #5b6b80; }
    .title { color: #0f172a; }
    .chip { display: inline-block; border-radius: 999px; border: 1px solid #cfe3d8; padding: 6px 10px; font-size: 12px; font-weight: 700; color: #05603a; background: #ebfaf2; }
    .btn { display: inline-block; text-decoration: none; border-radius: 10px; padding: 12px 18px; font-weight: 700; font-size: 14px; }
    .btn-primary { background: #0f9d65; color: #ffffff !important; }
    .btn-secondary { background: #f5f8fb; color: #12263a !important; border: 1px solid #dbe5ef; }
    .btn-block { display: block; width: 100%; box-sizing: border-box; text-align: center; }
    .divider { border-top: 1px solid #e6edf4; }
    .tone-info { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
    .tone-success { background: #ecfdf3; color: #047857; border-color: #a7f3d0; }
    .tone-warning { background: #fff8eb; color: #b45309; border-color: #fde68a; }
    .tone-danger { background: #fff1f2; color: #be123c; border-color: #fecdd3; }
    .label-caps { font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 800; color: #445568; }
    .aura-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 14px;
      background: linear-gradient(140deg, #0f9d65 0%, #13b87f 55%, #0e7fd6 100%);
      color: #ffffff;
      font-size: 22px;
      font-weight: 800;
      line-height: 1;
      box-shadow: 0 8px 18px rgba(15, 157, 101, 0.28);
    }
    .metric-pill {
      display: inline-block;
      border: 1px solid #cfe3d8;
      border-radius: 999px;
      background: #ebfaf2;
      color: #05603a;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.2;
      padding: 6px 10px;
      margin-right: 6px;
      margin-bottom: 6px;
    }
    .mobile-stack { width: 100%; }
    @media only screen and (max-width: 640px) {
      .px-28 { padding-left: 18px !important; padding-right: 18px !important; }
      .py-24 { padding-top: 18px !important; padding-bottom: 18px !important; }
      .h-mobile-auto { height: auto !important; }
      .hide-mobile { display: none !important; }
      .mobile-block { display: block !important; width: 100% !important; }
      .mobile-card-gap td { display: block !important; width: 100% !important; }
    }
    @media (prefers-color-scheme: dark) {
      .bg-page { background: #0b1220 !important; }
      .card { background: #101b2d !important; border-color: #26344a !important; }
      .inner-card { background: #0f1a2c !important; border-color: #2b3a51 !important; }
      .muted { color: #b8c6d9 !important; }
      .title { color: #f2f6fc !important; }
      .label-caps { color: #9fb3cc !important; }
      .divider { border-top-color: #2d3b52 !important; }
      .btn-secondary { background: #152238 !important; color: #e6eefb !important; border-color: #2c3b55 !important; }
      .chip { background: #0f3324 !important; border-color: #1f6849 !important; color: #92f1c2 !important; }
      .metric-pill { background: #133225 !important; border-color: #1f6849 !important; color: #92f1c2 !important; }
      .tone-info { background: #0d2648 !important; border-color: #1e3a8a !important; color: #93c5fd !important; }
      .tone-success { background: #0f3324 !important; border-color: #1f6849 !important; color: #9ae6b4 !important; }
      .tone-warning { background: #3a2a10 !important; border-color: #7c5a1d !important; color: #fcd34d !important; }
      .tone-danger { background: #3b1a21 !important; border-color: #7f1d35 !important; color: #fda4af !important; }
      .hero { background: linear-gradient(135deg, #0b2340 0%, #0f2b2f 100%) !important; }
      .footer-links a { color: #b5f2d5 !important; }
    }
    [data-ogsc] .bg-page { background: #0b1220 !important; }
    [data-ogsc] .card { background: #101b2d !important; border-color: #26344a !important; }
    [data-ogsc] .inner-card { background: #0f1a2c !important; border-color: #2b3a51 !important; }
    [data-ogsc] .muted { color: #b8c6d9 !important; }
    [data-ogsc] .title { color: #f2f6fc !important; }
    [data-ogsc] .label-caps { color: #9fb3cc !important; }
    [data-ogsc] .divider { border-top-color: #2d3b52 !important; }
    [data-ogsc] .btn-secondary { background: #152238 !important; color: #e6eefb !important; border-color: #2c3b55 !important; }
    [data-ogsc] .metric-pill { background: #133225 !important; border-color: #1f6849 !important; color: #92f1c2 !important; }
    [data-ogsc] .hero { background: linear-gradient(135deg, #0b2340 0%, #0f2b2f 100%) !important; }
  </style>
`;
const toneClassByValue = {
    info: 'tone-info',
    success: 'tone-success',
    warning: 'tone-warning',
    danger: 'tone-danger',
};
const toneVisualByValue = {
    info: {
        icon: '🔔',
        background: '#e9f5ff',
        border: '#bfdbfe',
        color: '#1d4ed8',
    },
    success: {
        icon: '✓',
        background: '#ecfdf3',
        border: '#a7f3d0',
        color: '#047857',
    },
    warning: {
        icon: '⏳',
        background: '#fff8eb',
        border: '#fde68a',
        color: '#b45309',
    },
    danger: {
        icon: '⚠',
        background: '#fff1f2',
        border: '#fecdd3',
        color: '#be123c',
    },
};
const renderPostCardRows = (posts) => {
    if (posts.length === 0) {
        return `
      <tr>
        <td class="muted" style="padding: 14px 0; font-size: 14px;">
          No new posts this week yet. Your next digest will include updates as soon as activity picks up.
        </td>
      </tr>
    `;
    }
    return posts
        .slice(0, 5)
        .map((post) => {
        const title = escapeHtml(post.title || 'Untitled post');
        const summary = escapeHtml(post.summary || '');
        const author = escapeHtml(post.authorName || 'Aura member');
        const postedAt = escapeHtml(post.postedAtLabel || '');
        const statLine = escapeHtml(post.statLine || '');
        const href = sanitizeUrl(post.url);
        const thumbnailUrl = sanitizeUrl(post.thumbnailUrl || '');
        const hasThumb = thumbnailUrl !== '#';
        return `
        <tr>
          <td style="padding: 10px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card">
              <tr class="mobile-card-gap">
                ${hasThumb
            ? `
                  <td class="mobile-block" width="116" style="padding: 14px;">
                    <img
                      src="${thumbnailUrl}"
                      alt=""
                      width="88"
                      style="display:block;width:88px;height:88px;border-radius:10px;object-fit:cover;border:1px solid #dbe5ef;"
                    />
                  </td>
                `
            : ''}
                <td class="mobile-block" style="padding: 14px ${hasThumb ? '14px 14px 14px 0' : '16px'};">
                  <p class="title" style="margin:0 0 6px 0; font-size: 16px; font-weight: 700; line-height: 1.35;">${title}</p>
                  ${summary
            ? `<p class="muted" style="margin:0 0 8px 0; font-size: 13px; line-height: 1.45;">${summary}</p>`
            : ''}
                  <p class="muted" style="margin:0; font-size: 12px; line-height: 1.4;">
                    ${author}${postedAt ? ` • ${postedAt}` : ''}${statLine ? ` • ${statLine}` : ''}
                  </p>
                  <p style="margin:10px 0 0 0;">
                    <a href="${href}" class="muted" style="font-size: 13px; font-weight: 700; text-decoration: none; color: #0f9d65;">
                      Open post →
                    </a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `;
    })
        .join('');
};
const renderNotificationRows = (items, max = 6) => {
    if (items.length === 0) {
        return `
      <tr>
        <td class="muted" style="padding: 14px 0; font-size: 14px;">
          You're all caught up. No pending notifications right now.
        </td>
      </tr>
    `;
    }
    return items
        .slice(0, max)
        .map((item) => {
        const title = escapeHtml(item.title || 'Notification');
        const summary = escapeHtml(item.summary || '');
        const time = escapeHtml(item.timestampLabel || '');
        const href = sanitizeUrl(item.url);
        const toneClass = toneClassByValue[item.tone || 'info'];
        const toneLabel = escapeHtml((item.tone || 'info').toUpperCase());
        return `
        <tr>
          <td style="padding: 8px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card">
              <tr>
                <td style="padding: 14px 14px 12px 14px;">
                  <span class="chip ${toneClass}" style="font-size: 10px; letter-spacing: 0.04em;">${toneLabel}</span>
                  <p class="title" style="margin: 10px 0 6px 0; font-size: 15px; font-weight: 700;">${title}</p>
                  ${summary
            ? `<p class="muted" style="margin:0 0 8px 0; font-size: 13px; line-height:1.45;">${summary}</p>`
            : ''}
                  <p class="muted" style="margin:0; font-size: 12px;">${time}</p>
                  <p style="margin:10px 0 0 0;">
                    <a href="${href}" class="muted" style="font-size: 13px; font-weight: 700; text-decoration: none; color: #0f9d65;">
                      Review →
                    </a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `;
    })
        .join('');
};
const renderActionNotificationRows = (items, max = 6) => {
    if (items.length === 0) {
        return `
      <tr>
        <td style="padding: 8px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="inner-card">
            <tr>
              <td class="muted" style="padding: 16px; font-size: 14px; line-height: 1.45;">
                You are all caught up. New activity will show here as it happens.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
    }
    return items
        .slice(0, max)
        .map((item) => {
        const title = escapeHtml(item.title || 'Notification');
        const summary = escapeHtml(item.summary || '');
        const time = escapeHtml(item.timestampLabel || '');
        const href = sanitizeUrl(item.url);
        const tone = toneVisualByValue[item.tone || 'info'];
        return `
        <tr>
          <td style="padding: 8px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="inner-card">
              <tr>
                <td width="58" style="padding:16px 0 16px 16px; vertical-align:top;">
                  <span
                    style="
                      display:inline-flex;
                      align-items:center;
                      justify-content:center;
                      width:34px;
                      height:34px;
                      border-radius:999px;
                      background:${tone.background};
                      border:1px solid ${tone.border};
                      color:${tone.color};
                      font-size:15px;
                      font-weight:700;
                      line-height:1;
                    "
                  >${tone.icon}</span>
                </td>
                <td style="padding:16px 16px 16px 8px; vertical-align:top;">
                  <p class="title" style="margin:0 0 6px 0; font-size:15px; font-weight:700; line-height:1.35;">${title}</p>
                  ${summary
            ? `<p class="muted" style="margin:0 0 8px 0; font-size:13px; line-height:1.45;">${summary}</p>`
            : ''}
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td class="muted" style="font-size:12px; line-height:1.3;">${time}</td>
                      <td align="right" style="font-size:12px; line-height:1.3;">
                        <a href="${href}" style="text-decoration:none; color:#0f9d65; font-weight:700;">Review</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `;
    })
        .join('');
};
const renderFooter = (brandName, managePreferencesUrl, unsubscribeUrl) => `
  <tr>
    <td style="padding: 18px 28px 0 28px;" class="px-28">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td class="divider" style="height:1px; font-size:0; line-height:0;">&nbsp;</td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding: 14px 28px 26px 28px;" class="px-28 footer-links">
      <p class="muted" style="margin:0 0 8px 0; font-size:12px; line-height:1.5;">
        This weekly digest was sent by ${escapeHtml(brandName)}.
      </p>
      <p class="muted" style="margin:0; font-size:12px; line-height:1.5;">
        <a href="${sanitizeUrl(managePreferencesUrl)}" style="color:#0f9d65; text-decoration: none; font-weight:700;">Manage preferences</a>
        &nbsp;•&nbsp;
        <a href="${sanitizeUrl(unsubscribeUrl)}" style="color:#0f9d65; text-decoration: none; font-weight:700;">Unsubscribe</a>
      </p>
    </td>
  </tr>
`;
const buildWeeklyPulseDigestTemplate = (input) => {
    var _a, _b, _c, _d, _e, _f;
    const brandName = escapeHtml((input.brandName || 'Aura Social').trim() || 'Aura Social');
    const recipientName = escapeHtml((input.recipientName || 'there').trim() || 'there');
    const weekLabel = escapeHtml((input.weekLabel || 'This week').trim() || 'This week');
    const ctaLabel = escapeHtml((input.ctaLabel || 'Open Aura').trim() || 'Open Aura');
    const preheader = escapeHtml((input.preheader || `Your weekly Aura recap for ${weekLabel}`).trim() ||
        `Your weekly Aura recap for ${weekLabel}`);
    const appUrl = sanitizeUrl(input.appUrl);
    const postCount = toCount((_b = (_a = input.stats) === null || _a === void 0 ? void 0 : _a.newPosts) !== null && _b !== void 0 ? _b : input.posts.length);
    const unreadCount = toCount((_d = (_c = input.stats) === null || _c === void 0 ? void 0 : _c.unreadNotifications) !== null && _d !== void 0 ? _d : input.notifications.length);
    const profileViews = toCount((_e = input.stats) === null || _e === void 0 ? void 0 : _e.profileViews);
    const connectionRequests = toCount((_f = input.stats) === null || _f === void 0 ? void 0 : _f.connectionRequests);
    const html = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${renderBaseStyles()}
  </head>
  <body class="bg-page" style="margin:0; padding:0; background:#f1f5f9;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg-page" style="background:#f1f5f9;">
      <tr>
        <td style="padding: 24px 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="container card">
            <tr>
              <td style="padding: 22px 28px 16px 28px;" class="px-28">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td valign="middle">
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding-right:10px;">
                            <span class="aura-mark" aria-hidden="true">A</span>
                          </td>
                          <td>
                            <p style="margin:0; font-size:13px; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; color:#0f9d65;">${brandName}</p>
                            <p class="muted" style="margin:4px 0 0 0; font-size:12px; line-height:1.35;">Weekly Pulse · ${weekLabel}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td align="right" class="title" style="font-size:14px; font-weight:700; color:#0f172a; vertical-align:middle;">
                      Hi ${recipientName}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 28px;" class="px-28">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr><td class="divider" style="height:1px; font-size:0; line-height:0;">&nbsp;</td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 28px 8px 28px;" class="px-28">
                <h1 class="title" style="margin:0; font-size:34px; line-height:1.12; font-weight:800;">Your weekly Aura snapshot</h1>
                <p class="muted" style="margin:12px 0 0 0; font-size:14px; line-height:1.45;">
                  <span class="metric-pill">${postCount} new posts</span>
                  <span class="metric-pill">${unreadCount} unread notifications</span>
                  ${profileViews > 0 ? `<span class="metric-pill">${profileViews} profile views</span>` : ''}
                  ${connectionRequests > 0 ? `<span class="metric-pill">${connectionRequests} connection requests</span>` : ''}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 28px 4px 28px;" class="px-28">
                <p class="label-caps" style="margin:0;">Top posts this week</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 2px 28px 8px 28px;" class="px-28">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${renderPostCardRows(input.posts)}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 28px 4px 28px;" class="px-28">
                <p class="label-caps" style="margin:0;">Notification summary</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 2px 28px 12px 28px;" class="px-28">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${renderNotificationRows(input.notifications)}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 28px 12px 28px;" class="px-28">
                <a href="${appUrl}" class="btn btn-primary btn-block">${ctaLabel}</a>
              </td>
            </tr>
            ${renderFooter(brandName, input.managePreferencesUrl, input.unsubscribeUrl)}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
    const textLines = [
        `${brandName} Weekly Pulse`,
        `Week: ${weekLabel}`,
        '',
        `Hi ${input.recipientName || 'there'},`,
        `You have ${postCount} new posts and ${unreadCount} unread notifications this week.`,
    ];
    if (profileViews > 0) {
        textLines.push(`Profile views: ${profileViews}`);
    }
    if (connectionRequests > 0) {
        textLines.push(`Connection requests: ${connectionRequests}`);
    }
    textLines.push('', 'Top posts:');
    if (input.posts.length === 0) {
        textLines.push('- No new posts this week.');
    }
    else {
        input.posts.slice(0, 5).forEach((post) => {
            const title = post.title || 'Untitled post';
            textLines.push(`- ${title}: ${sanitizeUrl(post.url)}`);
        });
    }
    textLines.push('', 'Notifications:');
    if (input.notifications.length === 0) {
        textLines.push('- You are all caught up.');
    }
    else {
        input.notifications.slice(0, 6).forEach((item) => {
            textLines.push(`- ${item.title}: ${sanitizeUrl(item.url)}`);
        });
    }
    textLines.push('', `Open Aura: ${appUrl}`, `Manage preferences: ${sanitizeUrl(input.managePreferencesUrl)}`, `Unsubscribe: ${sanitizeUrl(input.unsubscribeUrl)}`);
    return {
        subject: `${brandName} weekly recap • ${weekLabel}`,
        html,
        text: textLines.join('\n'),
    };
};
exports.buildWeeklyPulseDigestTemplate = buildWeeklyPulseDigestTemplate;
const buildNotificationActionDigestTemplate = (input) => {
    var _a;
    const brandName = escapeHtml((input.brandName || 'Aura Social').trim() || 'Aura Social');
    const recipientName = escapeHtml((input.recipientName || 'there').trim() || 'there');
    const weekLabel = escapeHtml((input.weekLabel || 'This week').trim() || 'This week');
    const ctaLabel = escapeHtml((input.ctaLabel || 'Open Inbox').trim() || 'Open Inbox');
    const preheader = escapeHtml((input.preheader || `Your notification actions for ${weekLabel}`).trim() ||
        `Your notification actions for ${weekLabel}`);
    const appUrl = sanitizeUrl(input.appUrl);
    const inboxUrl = sanitizeUrl(input.inboxUrl || input.appUrl);
    const mentionCount = toCount(input.mentionCount);
    const requestCount = toCount(input.requestCount);
    const unreadCount = toCount((_a = input.unreadCount) !== null && _a !== void 0 ? _a : input.notifications.length);
    const unreadLabel = unreadCount === 1 ? 'notification' : 'notifications';
    const attentionHeadline = unreadCount > 0
        ? `You have ${unreadCount} unread ${unreadLabel} to review`
        : `You're all caught up for ${weekLabel}`;
    const openAuraLabel = `Go to ${brandName}`;
    const html = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${renderBaseStyles()}
  </head>
  <body class="bg-page" style="margin:0; padding:0; background:#f1f5f9;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg-page" style="background:#f1f5f9;">
      <tr>
        <td style="padding: 24px 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="container card">
            <tr>
              <td style="padding: 22px 28px 16px 28px;" class="px-28">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td valign="middle">
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding-right:10px;">
                            <span class="aura-mark" aria-hidden="true">A</span>
                          </td>
                          <td>
                            <p style="margin:0; font-size:13px; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; color:#0f9d65;">${brandName}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td align="right" class="title" style="font-size:14px; font-weight:700; color:#0f172a; vertical-align:middle;">
                      ${recipientName}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 28px;" class="px-28">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr><td class="divider" style="height:1px; font-size:0; line-height:0;">&nbsp;</td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 22px 28px 10px 28px;" class="px-28">
                <h1 class="title" style="margin:0; font-size:36px; line-height:1.12; font-weight:800;">${escapeHtml(attentionHeadline)}</h1>
                <p class="muted" style="margin:12px 0 0 0; font-size:14px; line-height:1.45;">
                  ${weekLabel} at a glance:
                  <span class="metric-pill">${unreadCount} unread</span>
                  <span class="metric-pill">${mentionCount} mentions</span>
                  <span class="metric-pill">${requestCount} requests</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 2px 28px 0 28px;" class="px-28">
                <p class="label-caps" style="margin:0 0 6px 0;">Notifications</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 2px 28px 10px 28px;" class="px-28">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${renderActionNotificationRows(input.notifications, 8)}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 12px 28px 0 28px;" class="px-28">
                <a href="${inboxUrl}" class="btn btn-primary btn-block">${ctaLabel}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 10px 28px 0 28px;" class="px-28">
                <a href="${appUrl}" class="btn btn-secondary btn-block">${openAuraLabel}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 28px 4px 28px;" class="px-28">
                <p class="muted" style="margin:0; font-size:12px; line-height:1.45;">
                  Was this email useful?
                  <a href="${appUrl}" style="color:#0f9d65; text-decoration:none; font-weight:700;">Useful</a>
                  &nbsp;|&nbsp;
                  <a href="${sanitizeUrl(input.managePreferencesUrl)}" style="color:#0f9d65; text-decoration:none; font-weight:700;">Not useful</a>
                </p>
              </td>
            </tr>
            ${renderFooter(brandName, input.managePreferencesUrl, input.unsubscribeUrl)}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
    const textLines = [
        `${brandName} Action Digest`,
        `Week: ${weekLabel}`,
        '',
        `Hi ${input.recipientName || 'there'},`,
        attentionHeadline,
        `Unread: ${unreadCount} | Mentions: ${mentionCount} | Requests: ${requestCount}`,
        '',
        'Priority notifications:',
    ];
    if (input.notifications.length === 0) {
        textLines.push('- No pending items.');
    }
    else {
        input.notifications.slice(0, 8).forEach((item) => {
            textLines.push(`- ${item.title}: ${sanitizeUrl(item.url)}`);
        });
    }
    if ((input.topPosts || []).length > 0) {
        textLines.push('', 'Posts you may have missed:');
        (input.topPosts || []).slice(0, 3).forEach((post) => {
            textLines.push(`- ${post.title || 'Untitled post'}: ${sanitizeUrl(post.url)}`);
        });
    }
    textLines.push('', `Open inbox: ${inboxUrl}`, `Open feed: ${appUrl}`, `Manage preferences: ${sanitizeUrl(input.managePreferencesUrl)}`, `Unsubscribe: ${sanitizeUrl(input.unsubscribeUrl)}`);
    return {
        subject: `${brandName} notification digest • ${weekLabel}`,
        html,
        text: textLines.join('\n'),
    };
};
exports.buildNotificationActionDigestTemplate = buildNotificationActionDigestTemplate;
