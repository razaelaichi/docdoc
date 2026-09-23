// Errors that are safe to show to clients. Anything else becomes INTERNAL_ERROR.
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const validationFailed = (issues) => new AppError(400, "VALIDATION_ERROR", "Invalid request", { issues });
export const unauthorized = (message = "Authentication required") => new AppError(401, "UNAUTHORIZED", message);
export const invalidCredentials = () => new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
export const forbidden = (message = "You do not have permission to perform this action") =>
  new AppError(403, "FORBIDDEN", message);
export const notFound = (message = "Resource not found") => new AppError(404, "NOT_FOUND", message);
export const conflict = (message) => new AppError(409, "CONFLICT", message);
export const rateLimited = () => new AppError(429, "RATE_LIMITED", "Too many requests, please try again later");
export const accountLocked = () =>
  new AppError(429, "ACCOUNT_LOCKED", "Too many failed sign-in attempts, please try again later");
export const dependencyUnavailable = (details) =>
  new AppError(503, "DEPENDENCY_UNAVAILABLE", "A required service is unavailable", details);
