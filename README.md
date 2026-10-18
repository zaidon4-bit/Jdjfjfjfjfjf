# Survey AI Assistant — central subscriptions + Gemini proxy

This version replaces device-only accounts and the public GitHub subscription manifest with a central REST API and PostgreSQL database.

## What is centralized

- User registration and login (bcrypt password hashing + signed expiring JWT session).
- User profiles and authoritative subscription status/dates.
- Subscription plans and purchase requests without public in-app prices or currency. Orders preserve the plan name and duration; the amount is agreed outside the app.
- Admin review of orders, explicit approve/reject actions, plan name/duration/availability management, a central audit trail, and subscription activation, extension, suspension, or expiry.
- Gemini text analysis and image OCR through the backend only. Gemini keys are configured in the server environment, never inside the APK, and the server rotates among available keys when it encounters quota/auth/transient errors. Successful OCR and analysis requests count against the configured daily limit.

Survey analysis history and saved question memory remain local on each user's device. They are not uploaded to the server. Images are resized on-device and processed by Gemini through the backend; the app backend does not write them to disk or database.

## Important about payments

This build provides **manual payment review**. A customer selects a plan and submits a transaction reference/note; a manager must independently verify that the payment really arrived before pressing “Confirm payment and activate”. There is no automatic card/crypto payment gateway wired up yet. `PAYMENT_INSTRUCTIONS` must be configured on the server before order submission is enabled. Never approve an order only because the user typed a reference.

## Deploy the API first

See [`backend/README.md`](backend/README.md). The API requires a persistent PostgreSQL database and the environment variables shown in [`backend/.env.example`](backend/.env.example). It creates its schema and plan rows on startup. Create the first administrator through `ADMIN_USERNAME` and `ADMIN_PASSWORD`; there is no hard-coded admin PIN.

After deployment, verify `https://YOUR_API_HOST/health` returns `{"ok":true,...}`.

## Connect the APK to the API

1. In GitHub, open **Settings → Secrets and variables → Actions** and add repository secret `EXPO_PUBLIC_API_BASE_URL` with the public API URL, including `https://` and without a trailing slash.
2. Push this repository to the `main` branch or run **Actions → Build Android APK → Run workflow**.
3. Download the `survey-ai-release-apk` artifact after the workflow succeeds.
4. Log in to the app using the admin username/password configured on the server to see the admin dashboard. Users create their own accounts through the normal registration screen.

The build workflow deliberately fails if the backend URL secret is missing, instead of producing an APK that cannot connect.

## Local development

- Frontend: copy `.env.example` to `.env`, replace `EXPO_PUBLIC_API_BASE_URL` with your deployed HTTPS API URL, then run `npm install` and `npm start`.
- Backend: see its README; do not commit `.env` or live secrets.
- Do not place Gemini API keys in `EXPO_PUBLIC_*` variables, app config, a public repository, or the APK. `EXPO_PUBLIC_API_BASE_URL` is public by design; the Gemini keys and JWT secret are not.

## Security notes

- The API validates subscription status on every Gemini request; the UI's local status alone does not grant paid API access.
- Passwords are hashed server-side using bcrypt. Sessions use JWTs signed with a server-only secret.
- Set strong, unique admin credentials, keep the database private, use HTTPS, and set billing alerts for Gemini usage. Production PostgreSQL TLS certificate verification is enabled; do not disable it except as a documented short-term exception.
- Rate limiting is enabled on sign-in and Gemini routes. This is an initial small-service implementation; before high-volume commercial launch, add payment-provider webhooks, usage accounting/quotas per subscriber, monitoring, and a formal backup/restore plan.

## Checks

From the repository root, run `npm run check:backend` and `npm run test:backend` to perform server syntax checks and Gemini key-rotation/OCR tests. Before accepting payments, verify the full register → order → admin approval/rejection → subscription expiry/suspension workflow on a staging database and test backup restoration.

## Fixed-answer memory (local JSON)

Analysis suggestions are saved to history, but they do **not** become fixed answers automatically. After reviewing a result, choose **"حفظ هذه الإجابة كإجابة ثابتة"**. The app stores the answer in its private on-device JSON file (`survey-ai-answer-memory.json`) and keeps a secondary AsyncStorage copy. A repeat is served from memory only when the normalized question and the set of options match; fuzzy similarity is intentionally disabled. Option ordering may differ: the app maps the saved answer back to the matching option label.

Open **History → "إجابات ثابتة"** to review or delete saved answers. Deleting an answer allows the next analysis to generate a new suggestion. The same screen can export a portable `.json` copy through Android's share sheet. The JSON is local app data rather than an encrypted vault, so don't export or share it if it contains sensitive personal answers. Open-text responses can be edited by the user before saving; Gemini is instructed not to invent personal experiences or facts.

Export creates a portable copy, but this version does not yet include an in-app import/restore flow. Keep the exported file separately before clearing app data or uninstalling.
