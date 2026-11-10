// Suzi desktop (DEF-370): Settings → Suzi desktop. The server takes the person and the tenant from
// the session (req.user); nothing identifying is ever sent from here.
import api from './api';

const BASE = '/v1/suzi';

export function errorText(e) {
  return e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Unknown error';
}

/** The signed-in person's own API key, valid for `validityDays` (7, 30, 90 or 'never'). Shown once. */
export async function createApiKey(validityDays = 30) {
  const { data } = await api.post(`${BASE}/api-key`, { validityDays });
  return data; // { apiKey, keyPrefix, expiresAt, validityDays, serverUrl, connectLink }
}

export async function listDevices() {
  const { data } = await api.get(`${BASE}/devices`);
  return Array.isArray(data?.devices) ? data.devices : [];
}

export async function disconnectDevice(id) {
  await api.delete(`${BASE}/devices/${encodeURIComponent(id)}`);
}

// Link T30: the current Suzi installer for each system, straight from Suzi Master (nothing kept at Nexeo).
export async function listInstallers() {
  const { data } = await api.get(`${BASE}/installers`);
  return data ?? {}; // { macos: { available, version, sha256, size, file } | { available: false }, windows: … }
}

/** A short-lived download link (10 minutes) for one system; the browser opens it directly. */
export async function installerLink(os) {
  const { data } = await api.post(`${BASE}/installers/${encodeURIComponent(os)}/link`);
  return data; // { url, expiresAt }
}
