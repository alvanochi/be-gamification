class ApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;

    Object.setPrototypeOf(this, ApiError.prototype);
  }

  static badRequest(message: string): ApiError {
    return new ApiError(message, 400);
  }

  static unauthorized(message: string = 'Unauthorized'): ApiError {
    return new ApiError(message, 401);
  }

  static forbidden(message: string = 'Forbidden'): ApiError {
    return new ApiError(message, 403);
  }

  static notFound(message: string = 'Resource not found'): ApiError {
    return new ApiError(message, 404);
  }

  // static conflict(message: string): ApiError {
  //   return new ApiError(message, 409);
  // }

  static internal(message: string = 'Internal Server Error'): ApiError {
    return new ApiError(message, 500);
  }
}

export default ApiError;
