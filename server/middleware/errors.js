import { ApiError } from '../lib/errors.js';

const PG_MESSAGES = {
  '23505': [409, 'DUPLICATE', 'That value is already in use.'],
  '23503': [409, 'REFERENCE_CONFLICT', 'This record is still referenced by other data.'],
  '23514': [422, 'CONSTRAINT_VIOLATION', 'The data violates a business constraint.'],
  '22P02': [400, 'INVALID_INPUT', 'The submitted value has an invalid format.'],
  '22003': [400, 'OUT_OF_RANGE', 'The submitted number is out of range.'],
  '40001': [503, 'SERIALIZATION_FAILURE', 'The request conflicted with another change. Please retry.'],
  '40P01': [503, 'DEADLOCK', 'The request conflicted with another change. Please retry.'],
  '55P03': [503, 'LOCK_TIMEOUT', 'The record is busy. Please retry.'],
  '57014': [503, 'QUERY_TIMEOUT', 'The request took too long. Please retry.'],
};

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on the server.';
  let fields = null;
  if (error instanceof ApiError) {
    status = error.status;
    code = error.code;
    message = error.message;
    fields = error.fields;
  } else if (error?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'The request is too large.';
  } else if (error?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'The request body is not valid JSON.';
  } else if (PG_MESSAGES[error?.code]) {
    [status, code, message] = PG_MESSAGES[error.code];
  }
  const log = {
    level: status >= 500 ? 'error' : 'warn',
    msg: 'request_failed',
    method: req.method,
    path: req.path,
    status,
    code,
    userId: req.user?.id || null,
  };
  if (status >= 500) {
    log.error = error?.message;
    log.stack = error?.stack?.split('\n').slice(0, 6).join(' | ');
    log.pgCode = error?.code;
  }
  console.error(JSON.stringify(log));
  if (status >= 500 && /password|secret|token/i.test(String(error?.message || ''))) {
    message = 'Something went wrong on the server.';
  }
  res.status(status).json({ error: { code, message, ...(fields ? { fields } : {}) } });
}
