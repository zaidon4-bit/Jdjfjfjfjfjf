/** Public app configuration. This URL is not a secret; API credentials must remain on the backend. */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim().replace(/\/+$/, '');
export const APP_NAME = 'Survey AI Assistant';
export const APP_VERSION = '2.0.0';
export const GEMINI_MODEL_LABEL = 'Managed securely on the server';
