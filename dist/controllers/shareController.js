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
        var _a, _b, _c, _d;
        try {
            const escapeHtml = (unsafe) => {
                return unsafe
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            };
            const truncateContent = (text, maxLength = 200) => {
                if (text.length <= maxLength)
                    return text;
                return text.substring(0, maxLength - 3) + '...';
            };
            const { id } = req.params;
            const db = (0, db_1.getDB)();
            const post = yield db.collection('posts').findOne({ id });
            const frontendUrl = process.env.VITE_FRONTEND_URL ||
                (req.headers.origin ? req.headers.origin.toString() : 'https://www.aura.net.za');
            if (!post) {
                // Fallback to generic metadata if post not found
                return res.redirect(frontendUrl);
            }
            // Construct metadata
            const authorName = ((_a = post.author) === null || _a === void 0 ? void 0 : _a.name) || 'Aura User';
            const authorHandle = ((_b = post.author) === null || _b === void 0 ? void 0 : _b.handle) || '';
            const trustScore = ((_c = post.author) === null || _c === void 0 ? void 0 : _c.trustScore) || 0;
            const postContent = post.content || '';
            // Title: Post title (if time capsule) or first line of content
            const firstLine = postContent.split('\n').find((line) => line.trim().length > 0) || 'Post on Aura';
            const titleText = post.timeCapsuleTitle || (firstLine.length > 80 ? firstLine.substring(0, 80) + '...' : firstLine);
            const title = escapeHtml(titleText);
            // Description: First 2-3 meaningful sentences
            // Split by sentence delimiters (., !, ?) keeping the delimiter
            const sentences = postContent.match(/[^.!?]+[.!?]+/g) || [postContent];
            // Take first 3 sentences or up to 300 chars
            const descriptionText = sentences.slice(0, 3).join(' ').trim();
            const description = escapeHtml(truncateContent(descriptionText, 300));
            const image = post.mediaUrl || `${frontendUrl}/og-image.jpg?v=2`;
            // Use the canonical frontend URL as requested
            const url = `${frontendUrl}/post/${id}`;
            const structuredData = {
                "@context": "https://schema.org",
                "@type": "BlogPosting",
                headline: title,
                description,
                image,
                author: {
                    "@type": "Person",
                    name: authorName,
                    url: authorHandle
                        ? `${frontendUrl}/${authorHandle.startsWith('@') ? authorHandle : `@${authorHandle}`}`
                        : `${frontendUrl}/profile/${(_d = post.author) === null || _d === void 0 ? void 0 : _d.id}`
                },
                datePublished: post.timestamp || new Date().toISOString(),
                url,
                publisher: {
                    "@type": "Organization",
                    name: "Aura",
                    logo: {
                        "@type": "ImageObject",
                        url: `${frontendUrl}/logo.png`
                    }
                }
            };
            // Return HTML with meta tags and redirect
            const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>

  <!-- Primary Meta Tags -->
  <meta name="title" content="${title}" />
  <meta name="description" content="${description}" />
  <meta name="keywords" content="aura, post, social, network, ${authorHandle ? authorHandle + ',' : ''} radiance" />
  <meta name="author" content="${escapeHtml(authorName)}" />
  <meta name="robots" content="index, follow" />
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${url}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Aura" />
  <meta property="article:author" content="${escapeHtml(authorName)}" />

  <!-- Twitter / X -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${url}" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${image}" />
  <meta name="twitter:creator" content="${authorHandle ? '@' + authorHandle : '@auraapp'}" />
  <meta name="twitter:site" content="@auraapp" />

  <!-- Structured Data -->
  <script type="application/ld+json">
    ${JSON.stringify(structuredData)}
  </script>

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
    setTimeout(function() {
      window.location.href = "${url}";
    }, 100);
  </script>
</head>
<body>
  <div style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: system-ui, -apple-system, sans-serif;">
    <p>Redirecting to Aura...</p>
  </div>
</body>
</html>
      `;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.send(html);
        }
        catch (error) {
            console.error('Error serving share page:', error);
            res.status(500).send('Internal Server Error');
        }
    })
};
