export class DomainError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new DomainError(404, `${what} not found`);
export const invalid = (message: string, details?: unknown) => new DomainError(400, message, details);
export const versionConflict = (current: unknown) =>
  new DomainError(409, 'This item was changed somewhere else since you loaded it. Your edit was not saved.', { current });
