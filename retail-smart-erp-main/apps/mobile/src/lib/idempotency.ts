// Pure: an idempotency key that stays the same for retries of the same request and changes when
// the request itself changes (different sale / quantities) or after it succeeded.
export class IdempotencyKey {
  private signature: string | null = null
  private key: string | null = null
  constructor(private readonly mint: () => string) {}

  for(signature: string): string {
    if (this.key && this.signature === signature) return this.key
    this.signature = signature
    this.key = this.mint()
    return this.key
  }

  reset() {
    this.signature = null
    this.key = null
  }
}
