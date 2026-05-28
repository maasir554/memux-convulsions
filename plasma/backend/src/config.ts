/**
 * The backend used to persist provider/baseUrl/apiKey settings to a JSON
 * file on disk. With the cloud-only redesign, that's gone: keys live in
 * the .env file, the provider is fixed (Google AI Studio), and there's
 * nothing else to configure.
 *
 * Kept as a placeholder to preserve the import path in case future
 * backend-level settings reappear (rate limits, model allowlist, …).
 */
export const BACKEND_NAME = "plasma-backend";
