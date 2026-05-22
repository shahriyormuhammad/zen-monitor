import { describe, it, expect } from 'vitest';
import { AppError, getErrorStatus, getErrorMessage } from './errors';

describe('AppError', () => {
  it('sets message and default status 500', () => {
    const err = new AppError('something went wrong');
    expect(err.message).toBe('something went wrong');
    expect(err.status).toBe(500);
    expect(err.name).toBe('AppError');
    expect(err instanceof Error).toBe(true);
  });

  it('accepts explicit status', () => {
    const err = new AppError('Not found', 404);
    expect(err.status).toBe(404);
  });
});

describe('getErrorStatus', () => {
  it('returns status from AppError', () => {
    expect(getErrorStatus(new AppError('x', 403))).toBe(403);
  });

  it('returns fallback for non-AppError', () => {
    expect(getErrorStatus(new Error('boom'))).toBe(500);
    expect(getErrorStatus('string error')).toBe(500);
    expect(getErrorStatus(null)).toBe(500);
  });

  it('accepts custom fallback', () => {
    expect(getErrorStatus(new Error('x'), 503)).toBe(503);
  });
});

describe('getErrorMessage', () => {
  it('returns message from AppError', () => {
    expect(getErrorMessage(new AppError('Access denied', 403))).toBe('Access denied');
  });

  it('returns fallback for non-AppError', () => {
    expect(getErrorMessage(new Error('db crash'))).toBe('Internal Server Error');
    expect(getErrorMessage('raw string')).toBe('Internal Server Error');
    expect(getErrorMessage(null)).toBe('Internal Server Error');
  });

  it('accepts custom fallback', () => {
    expect(getErrorMessage(new Error('x'), 'Custom fallback')).toBe('Custom fallback');
  });
});
