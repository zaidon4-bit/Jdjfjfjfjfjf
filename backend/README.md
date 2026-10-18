# Central API deployment

The app expects a persistent Node.js API and PostgreSQL database. GitHub Actions only builds the APK; it does not host the runtime API.

## Deploy on Render + PostgreSQL (or equivalent)

1. Create a PostgreSQL database. Copy its connection string into `DATABASE_URL`. Prefer a provider's private/internal connection string when the API and database are on the same provider; otherwise use its TLS-enabled external string.
2. Create a **Web Service** from this repository, set **Root Directory** to `backend`, **Build Command** to `npm install`, and **Start Command** to `npm start`.
3. Add these environment variables in the backend host's dashboard:
   - `NODE_ENV=production`
   - `DATABASE_URL` (private database connection string)
   - `JWT_SECRET` (a random string of at least 32 characters; generate a fresh value)
   - `ADMIN_USERNAME` (unique 3–30 character username)
   - `ADMIN_PASSWORD` (strong unique password, at least 12 characters; bcrypt limit is 72 UTF-8 bytes)
   - optionally `ADMIN_FORCE_PASSWORD_RESET=true` for exactly one deploy when rotating an existing admin password, then set it back to `false` immediately
   - `GEMINI_API_KEYS` (one or more Gemini API keys separated by commas or newlines; server-only)
   - `GEMINI_MODEL=gemini-3.5-flash-lite`
   - `PAYMENT_INSTRUCTIONS` (the payment details and instructions shown to customers; leave unset until you've configured a real payment destination)
   - optionally `AI_REQUESTS_PER_MINUTE=12`, `AI_DAILY_LIMIT=100`, `PG_POOL_SIZE=10`, `PGSSL_REJECT_UNAUTHORIZED=true`, and `CORS_ORIGIN` for browser clients
4. Deploy. The API creates database tables and three default plans (`monthly`, `quarterly`, `yearly`) if they do not exist. The plans have durations and activation state only; no in-app price or currency is configured. In production it enforces PostgreSQL TLS certificate verification by normalizing the connection URL to `sslmode=verify-full`; set `PGSSL_REJECT_UNAUTHORIZED=false` only as a deliberate temporary exception if your provider has a broken/untrusted certificate chain. Avoid that exception for a commercial deployment.
5. Open `https://YOUR_API_HOST/health`; expect an `ok: true` response. Then test sign-in and Gemini from the app.

Never commit the real `.env` or paste real keys into support chats. Start from `.env.example` only. The backend does not load a local `.env` automatically. For local development with Node 20+, make a private `backend/.env` and run `node --env-file=.env src/server.js` from the `backend` folder.

## Subscription flow

1. A user registers and signs in; account/profile/subscription/order records live in PostgreSQL.
2. The user chooses a plan and submits a payment reference or note. The server stores a pending order and snapshots the plan name and duration. No plan prices or currencies are set or displayed in this app version; agree any amount and terms outside the app. The API does not trust the app to set subscription status.
3. The admin signs into the app using the server-configured administrator account, opens **لوحة الإدارة المركزية**, independently confirms payment, and chooses **تأكيد الدفع وتفعيل**. This creates a subscription row and updates the order transactionally.
4. The server checks subscription status and expiry for both Gemini analysis and image OCR requests. Expired or suspended users cannot use paid Gemini requests. The OCR endpoint validates image MIME type, Base64 size, and file signature before forwarding it to Gemini; image bytes are not written to the app database or disk. Each successful OCR extraction and each successful analysis counts as one request against the daily quota.

This is manual payment review only. No bank, card, or crypto payment is automatically verified. Add a payment provider and verify its webhook signatures before automatic activation.

## Gemini key rotation

Configure several keys with `GEMINI_API_KEYS`. Keep them only in the service's secret/environment configuration. The backend tries usable keys in rotation and applies a cooldown after quota/authentication/transient errors. Multiple keys associated with the same Google Cloud project may still share a quota, so this cannot guarantee extra capacity. `/api/admin/ai-status` is admin-protected and reports counts, not key values.

## Image OCR

The mobile app uses Expo ImagePicker to capture a photo or select a screenshot from the gallery, then resizes/compresses it locally. The app sends the compressed image over HTTPS to `POST /api/ai/ocr`; the backend validates it and forwards it to Gemini Vision for structured question/option extraction. The app shows the extracted text for user review before analysis. The app database and backend code do not store image bytes, but Google Gemini processes the image, so do not send images containing information the user should not share. Rebuild the APK after changing image-picker config plugins or native permissions.
