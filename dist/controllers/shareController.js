"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.shareController = void 0;
const db_1 = require("../db");
exports.shareController = {
    getPostShare: (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const post = yield db.collection('posts').findOne({ id });
            if (!post) {
                // Fallback to generic metadata if post not found
                const url = 'https://auraradiance.vercel.app';
                return res.redirect(url);
            }
            // Construct metadata
            // Escape HTML characters to prevent XSS in meta tags
            const escapeHtml = (unsafe) => {
                return unsafe
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            };
            const title = escapeHtml(`Post by ${((_a = post.author) === null || _a === void 0 ? void 0 : _a.name) || 'Aura User'} | Aura`);
            // Truncate content to ~200 chars
            const rawContent = post.content || '';
            const description = escapeHtml(rawContent.length > 200
                ? rawContent.substring(0, 197) + '...'
                : rawContent || 'Check out this post on Aura');
            const image = post.mediaUrl || 'https://auraradiance.vercel.app/og-image.svg';
            const url = `https://auraradiance.vercel.app/p/${id}`;
            // Return HTML with meta tags and redirect
            const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${url}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Aura" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${url}" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${image}" />

  <!-- LinkedIn -->
  <meta property="linkedin:title" content="${title}" />
  <meta property="linkedin:description" content="${description}" />
  <meta property="linkedin:image" content="${image}" />

  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background-color: #f8fafc;
      color: #334155;
    }
    .loader {
      text-align: center;
    }
    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #10b981;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>

  <script>
    // Redirect to the actual app
    setTimeout(function() {
      window.location.href = "${url}";
    }, 100);
  </script>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <p>Redirecting to Aura...</p>
    <p><small><a href="${url}">Click here if not redirected</a></small></p>
  </div>
</body>
</html>
      `;
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        }
        catch (error) {
            console.error('Error serving share page:', error);
            res.status(500).send('Internal Server Error');
        }
    })
};
