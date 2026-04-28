import { isProduction } from '../config/env.js';

export function notFound(req, _res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

export function errorHandler(error, _req, res, _next) {
  const statusCode = error.statusCode || error.status || 500;
  const payload = {
    success: false,
    message: error.message || 'Server error',
  };

  if (error.details) payload.details = error.details;
  if (!isProduction && error.stack) payload.stack = error.stack;

  if (error.name === 'ValidationError') {
    payload.message = Object.values(error.errors).map((item) => item.message).join(', ');
    return res.status(400).json(payload);
  }

  if (error.code === 11000) {
    payload.message = 'Duplicate record already exists';
    payload.details = error.keyValue;
    return res.status(409).json(payload);
  }

  return res.status(statusCode).json(payload);
}
