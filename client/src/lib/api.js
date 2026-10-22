const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function request(path, options = {}) {
   const url = `${API_BASE}${path}`;

   let response;

   try {
      response = await fetch(url, {
         ...options,
         headers: {
            ...(options.body
               ? { 'Content-Type': 'application/json' }
               : {}),
            ...options.headers,
         },
      });
   } catch {
      throw new Error(
         'Cannot reach the API. Please check your internet connection or backend server.'
      );
   }

   // DELETE requests may return no content.
   if (response.status === 204) {
      return null;
   }

   const contentType = response.headers.get('content-type') || '';

   // Read the response safely instead of blindly parsing JSON.
   const responseText = await response.text();

   let payload;

   if (contentType.includes('application/json')) {
      try {
         payload = responseText ? JSON.parse(responseText) : {};
      } catch {
         throw new Error(
            `The API returned invalid JSON (${response.status}).`
         );
      }
   } else {
      console.error('[API] Expected JSON but received another content type:', {
         url,
         status: response.status,
         contentType,
         responsePreview: responseText.slice(0, 200),
      });

      throw new Error(
         `The API returned an unexpected response (${response.status}). Check the API route and server logs.`
      );
   }

   if (!response.ok) {
      throw new Error(
         payload.error || `Request failed (${response.status}).`
      );
   }

   return payload;
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
         `/api/transcriptions?limit=200${search ? `&search=${encodeURIComponent(search)}` : ''
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
