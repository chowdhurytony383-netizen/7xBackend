import { AppError } from './appError.js';

function isDisabled(value) {
  return value === false;
}

export function canUserPlay(user) {
  return !isDisabled(user?.gameplayEnabled) && !isDisabled(user?.bettingEnabled);
}

export function canUserDeposit(user) {
  return !isDisabled(user?.depositEnabled);
}

export function canUserWithdraw(user) {
  return !isDisabled(user?.withdrawEnabled);
}

export function assertUserCanPlay(user) {
  if (!canUserPlay(user)) {
    throw new AppError('Betting and games are disabled for this account. Please contact support.', 403);
  }
}

export function assertUserCanDeposit(user) {
  if (!canUserDeposit(user)) {
    throw new AppError('Deposit is disabled for this account. Please contact support.', 403);
  }
}

export function assertUserCanWithdraw(user) {
  if (!canUserWithdraw(user)) {
    throw new AppError('Withdraw is disabled for this account. Please contact support.', 403);
  }
}
