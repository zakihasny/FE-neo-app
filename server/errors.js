export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
  }
}

export class PermanentJobError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PermanentJobError'
  }
}
