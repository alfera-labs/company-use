export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status:
      | 400
      | 401
      | 402
      | 403
      | 404
      | 409
      | 410
      | 422
      | 429
      | 500
      | 502
      | 503 = 500,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('validation_error', message, 422, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('not_found', `${resource} was not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('conflict', message, 409, details);
  }
}
