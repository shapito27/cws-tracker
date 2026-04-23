/**
 * Device registration with the CWS Tracker server.
 *
 * Called on extension install/startup to ensure this device has:
 *   - A generated UUID stored as settings.deviceId (survives across sessions)
 *   - An API key from the server stored as settings.serverApiKey
 *
 * The server auth model: the UUID is sent to POST /auth/register. The server
 * returns { apiKey, plan } — for now apiKey equals the UUID, but that may
 * change in future. The extension then sends the API key as X-API-Key on
 * every request to /proxy/* and /api/*.
 *
 * Registration is idempotent: if deviceId + serverApiKey are both set, it's
 * a no-op. If only deviceId is set (e.g. prior registration failed mid-way),
 * we reuse that deviceId on retry.
 *
 * Failure mode: network errors and non-OK server responses are logged, not
 * thrown. Downstream requests will just fail auth, which is recoverable on
 * the next startup.
 */

import { SERVER_URL } from '@/shared/types/settings';
import { SettingsManager } from '@/shared/utils/settings';

interface RegisterResponse {
  apiKey: string;
  plan: 'free' | 'pro';
}

export async function ensureDeviceRegistered(): Promise<void> {
  const settings = new SettingsManager();
  const all = await settings.getWithDefaults();

  if (all.deviceId && all.serverApiKey) {
    return;
  }

  // Ensure we have a stable deviceId before attempting registration.
  let deviceId = all.deviceId;
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await settings.set('deviceId', deviceId);
  }

  try {
    const response = await fetch(`${SERVER_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid: deviceId }),
    });

    if (!response.ok) {
      console.warn(`[registration] server returned HTTP ${response.status}`);
      return;
    }

    const data = await response.json() as RegisterResponse;
    if (!data.apiKey || typeof data.apiKey !== 'string') {
      console.warn('[registration] server response missing apiKey');
      return;
    }

    await settings.set('serverApiKey', data.apiKey);
  } catch (err) {
    console.warn('[registration] failed:', err instanceof Error ? err.message : err);
  }
}
