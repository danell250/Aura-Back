"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderJobAlertStatusTemplate = void 0;
const renderJobAlertStatusTemplate = (params) => `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${params.titleHtml}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f8fafc; color:#0f172a; margin:0; padding:32px 16px; }
      .card { max-width:560px; margin:0 auto; background:#fff; border:1px solid #e2e8f0; border-radius:18px; padding:28px; box-shadow:0 10px 30px rgba(15,23,42,0.06); }
      .eyebrow { font-size:11px; letter-spacing:0.14em; text-transform:uppercase; font-weight:800; color:#059669; }
      h1 { margin:10px 0 8px 0; font-size:28px; line-height:1.15; }
      p { color:#475569; line-height:1.6; }
      a { display:inline-flex; margin-top:18px; padding:12px 18px; border-radius:12px; text-decoration:none; background:#0f172a; color:#fff; font-weight:700; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="eyebrow">Aura Jobs</div>
      <h1>${params.titleHtml}</h1>
      <p>${params.bodyHtml}</p>
      ${params.actionHtml || `<a href="${params.jobsUrl}">Back to jobs</a>`}
    </div>
  </body>
</html>
`;
exports.renderJobAlertStatusTemplate = renderJobAlertStatusTemplate;
