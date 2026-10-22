const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || ''
).replace(/\/$/, '');

async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error(
      'Cannot reach the API. Please check your internet connection or backend server.'
    );
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      payload.error || `Request failed (${response.status}).`
    );
  }

  if (response.status === 204) return null;

  return response.json();
}

export const api = {
  baseUrl: API_BASE,

  websocketUrl: () => {
    const explicit = import.meta.env.VITE_WS_BASE_URL;

    if (explicit) {
      return `${explicit.replace(/^http/, 'ws').replace(/\/$/, '')}/ws/transcription`;
    }

    const protocol =
      window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    return `${protocol}//${window.location.host}/ws/transcription`;
  },

  health: () => request('/api/health'),

  stats: () => request('/api/stats'),

  list: (search = '') =>
    request(
      `/api/transcriptions?limit=200${
        search ? `&search=${encodeURIComponent(search)}` : ''
      }`
    ),

  get: (id) => request(`/api/transcriptions/${id}`),

  create: (payload) =>
    request('/api/transcriptions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  append: (id, text) =>
    request(`/api/transcriptions/${id}/append`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  update: (id, payload) =>
    request(`/api/transcriptions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  remove: (id) =>
    request(`/api/transcriptions/${id}`, {
      method: 'DELETE',
    }),
};
