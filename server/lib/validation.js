import { badRequest } from './errors.js';

export function asObject(value, name = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest(`${name} must be a JSON object.`);
  }
  return value;
}

export function text(value, field, { min = 1, max = 255, trim = true, optional = false, fallback = '' } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return fallback;
    throw badRequest(`${field} is required.`, 'VALIDATION_ERROR', { [field]: 'Required.' });
  }
  if (typeof value !== 'string') {
    throw badRequest(`${field} must be text.`, 'VALIDATION_ERROR', { [field]: 'Must be text.' });
  }
  const result = trim ? value.trim() : value;
  if (result.length < min || result.length > max) {
    throw badRequest(`${field} must be between ${min} and ${max} characters.`, 'VALIDATION_ERROR', {
      [field]: `Must be ${min}-${max} characters.`,
    });
  }
  return result;
}

export function pattern(value, field, regex, message) {
  if (!regex.test(value)) {
    throw badRequest(message, 'VALIDATION_ERROR', { [field]: message });
  }
  return value;
}

export function integer(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, optional = false, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return fallback;
    throw badRequest(`${field} is required.`, 'VALIDATION_ERROR', { [field]: 'Required.' });
  }
  const numeric = typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
    throw badRequest(`${field} must be a whole number between ${min} and ${max}.`, 'VALIDATION_ERROR', {
      [field]: `Must be an integer from ${min} to ${max}.`,
    });
  }
  return numeric;
}

export function boolean(value, field, { optional = false, fallback = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return fallback;
    throw badRequest(`${field} is required.`, 'VALIDATION_ERROR', { [field]: 'Required.' });
  }
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw badRequest(`${field} must be true or false.`, 'VALIDATION_ERROR', { [field]: 'Must be true or false.' });
}

export function oneOf(value, field, allowed, { optional = false, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return fallback;
    throw badRequest(`${field} is required.`, 'VALIDATION_ERROR', { [field]: 'Required.' });
  }
  if (!allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`, 'VALIDATION_ERROR', {
      [field]: `Allowed: ${allowed.join(', ')}.`,
    });
  }
  return value;
}

export function list(value, field, { min = 0, max = 500 } = {}) {
  if (!Array.isArray(value)) {
    throw badRequest(`${field} must be an array.`, 'VALIDATION_ERROR', { [field]: 'Must be an array.' });
  }
  if (value.length < min || value.length > max) {
    throw badRequest(`${field} must contain ${min}-${max} items.`, 'VALIDATION_ERROR', {
      [field]: `Must contain ${min}-${max} items.`,
    });
  }
  return value;
}

export function dateOnly(value, field, { optional = false, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return fallback;
    throw badRequest(`${field} is required.`, 'VALIDATION_ERROR', { [field]: 'Required.' });
  }
  const raw = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw badRequest(`${field} must be a date in YYYY-MM-DD format.`, 'VALIDATION_ERROR', {
      [field]: 'Use YYYY-MM-DD.',
    });
  }
  return raw;
}

export function email(value, field, { optional = true } = {}) {
  if (!value) {
    if (optional) return '';
    throw badRequest(`${field} is required.`, 'VALIDATION_ERROR', { [field]: 'Required.' });
  }
  const raw = String(value).trim();
  if (raw.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    throw badRequest(`${field} must be a valid email address.`, 'VALIDATION_ERROR', {
      [field]: 'Enter a valid email.',
    });
  }
  return raw;
}

export function idParam(value, name = 'id') {
  return integer(value, name, { min: 1, max: 9223372036854775807 });
}
