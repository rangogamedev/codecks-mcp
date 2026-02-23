/**
 * Custom error classes mirroring the Python codecks-cli exception hierarchy.
 */

export class CliError extends Error {
  readonly exitCode: number = 1;

  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export class SetupError extends CliError {
  override readonly exitCode: number = 2;

  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

export class HTTPError extends Error {
  constructor(
    public readonly code: number,
    public readonly reason: string,
    public readonly body: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(`HTTP ${code}: ${reason}`);
    this.name = "HTTPError";
  }
}
