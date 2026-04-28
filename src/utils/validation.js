import validator from 'validator';
import { AppError } from './appError.js';

export function requireString(value, name, min = 1, max = 500) {
  if (typeof value !== 'string') throw new AppError(`${name} must be a string`, 400);
  const trimmed = value.trim();
  if (trimmed.length < min) throw new AppError(`${name} is required`, 400);
  if (trimmed.length > max) throw new AppError(`${name} is too long`, 400);
  return trimmed;
}

export function optionalString(value, max = 500) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return String(value).trim().slice(0, max);
  return value.trim().slice(0, max);
}

export function requireEmail(value) {
  const email = requireString(value, 'Email', 3, 254).toLowerCase();
  if (!validator.isEmail(email)) throw new AppError('Invalid email address', 400);
  return email;
}

export function requireNumber(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new AppError(`${name} must be a number`, 400);
  if (number < min) throw new AppError(`${name} must be at least ${min}`, 400);
  if (number > max) throw new AppError(`${name} must be at most ${max}`, 400);
  return number;
}

export function requireInteger(value, name, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new AppError(`${name} must be an integer`, 400);
  if (number < min || number > max) throw new AppError(`${name} must be between ${min} and ${max}`, 400);
  return number;
}
