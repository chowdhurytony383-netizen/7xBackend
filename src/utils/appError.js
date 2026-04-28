export class AppError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function assertOrThrow(condition, message, statusCode = 400, details = undefined) {
  if (!condition) throw new AppError(message, statusCode, details);
}
