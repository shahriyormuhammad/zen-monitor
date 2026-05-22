export class AppError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

export function getErrorStatus(error: unknown, fallback = 500) {
  return error instanceof AppError ? error.status : fallback;
}

export function getErrorMessage(error: unknown, fallback = 'Internal Server Error') {
  return error instanceof AppError ? error.message : fallback;
}
