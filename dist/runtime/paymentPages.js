"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderPaymentCancelledPage = exports.renderPaymentSuccessPage = void 0;
const renderPaymentSuccessPage = (pkgParam) => `<!DOCTYPE html>
<html>
<head>
  <title>Payment Successful - Aura©</title>
  <meta http-equiv="refresh" content="3;url=/?payment=success${pkgParam}">
  <style>
    body { font-family: 'Inter', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f0fdf4; }
    .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); text-align: center; max-width: 400px; }
    h1 { color: #166534; margin-bottom: 1rem; }
    p { color: #374151; margin-bottom: 2rem; }
    .btn { background: #16a34a; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: 500; }
  </style>
</head>
<body>
  <div class="success">✅ Payment Successful!</div>
  <div class="message">If your payment was completed, your access will be activated shortly after verification.</div>
  <div class="message">Redirecting you back to Aura©...</div>
  <script>
    setTimeout(function() {
      window.location.href = '/?payment=success${pkgParam}';
    }, 3000);
  </script>
</body>
</html>`;
exports.renderPaymentSuccessPage = renderPaymentSuccessPage;
const renderPaymentCancelledPage = () => `<!DOCTYPE html>
<html>
<head>
  <title>Payment Cancelled - Aura©</title>
  <meta http-equiv="refresh" content="3;url=/">
  <style>
    body { font-family: system-ui; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; text-align: center; padding: 4rem; }
    .cancelled { font-size: 3rem; margin-bottom: 1rem; }
    .message { font-size: 1.2rem; opacity: 0.9; }
  </style>
</head>
<body>
  <div class="cancelled">❌ Payment Cancelled</div>
  <div class="message">You can return to the app anytime to complete your purchase.</div>
</body>
</html>`;
exports.renderPaymentCancelledPage = renderPaymentCancelledPage;
