export class ApiError extends Error {
  constructor(status, code, message, fields = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (message, code = 'VALIDATION_ERROR', fields = null) =>
  new ApiError(400, code, message, fields);

export const unauthorized = (message = 'Sign in to continue.') =>
  new ApiError(401, 'UNAUTHENTICATED', message);

export const forbidden = (message = 'You do not have permission to do that.') =>
  new ApiError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Record not found.') =>
  new ApiError(404, 'NOT_FOUND', message);

export const conflict = (message, code = 'CONFLICT') =>
  new ApiError(409, code, message);

export const unprocessable = (message, code = 'BUSINESS_RULE') =>
  new ApiError(422, code, message);

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
