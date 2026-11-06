export class OIOLValidationError extends Error {
  constructor(message, issues = []) { super(message); this.name = 'OIOLValidationError'; this.issues = issues; }
}
export class ProviderError extends Error {
  constructor(message, status = null, retryable = false) { super(message); this.name = 'ProviderError'; this.status = status; this.retryable = retryable; }
}
