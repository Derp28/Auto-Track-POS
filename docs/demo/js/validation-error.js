export class ValidationError extends Error {
  constructor(message, code = 'VALIDATION', fieldErrors = null) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}
