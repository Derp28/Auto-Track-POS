/**
 * Browser API client. The frontend never touches PostgreSQL directly.
 * All mutations include the per-session CSRF token; failures throw ApiError.
 */
let csrfToken = '';
let unauthorizedHandler = null;

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', fields = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.fieldErrors = fields || null;
  }
}

export function setCsrfToken(token) {
  csrfToken = typeof token === 'string' ? token : '';
}

export function getCsrfToken() {
  return csrfToken;
}

export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function request(method, path, body = undefined, { headers = {}, silent401 = false } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...headers,
    },
  };
  if (!['GET', 'HEAD'].includes(method.toUpperCase())) {
    options.headers['x-csrf-token'] = csrfToken;
  }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    throw new ApiError('The shop server could not be reached. Check the network and try again.', {
      code: 'NETWORK_ERROR',
      fields: null,
    });
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !silent401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/setup')) {
      unauthorizedHandler?.();
    }
    throw new ApiError(payload?.error?.message || `The server refused the request (${response.status}).`, {
      status: response.status,
      code: payload?.error?.code || 'HTTP_ERROR',
      fields: payload?.error?.fields || null,
    });
  }
  return payload;
}

export const api = {
  get: (path, options) => request('GET', path, undefined, options),
  post: (path, body, options) => request('POST', path, body, options),
  put: (path, body, options) => request('PUT', path, body, options),
  delete: (path, options) => request('DELETE', path, undefined, options),
};

export async function setupStatus() {
  return api.get('/api/auth/setup-status');
}

export async function login(username, password) {
  const result = await api.post('/api/auth/login', { username, password });
  setCsrfToken(result.csrfToken);
  return result;
}

export async function setup({ token, username, displayName, password }) {
  const result = await api.post('/api/auth/setup', { token, username, displayName, password });
  setCsrfToken(result.csrfToken);
  return result;
}

export async function me() {
  const result = await api.get('/api/auth/me', { silent401: true });
  setCsrfToken(result.csrfToken);
  return result;
}

export async function logout() {
  const result = await api.post('/api/auth/logout');
  setCsrfToken('');
  return result;
}

export async function changePassword(currentPassword, newPassword) {
  return api.post('/api/auth/change-password', { currentPassword, newPassword });
}
