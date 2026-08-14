/**
 * Unit of work — the transaction boundary.
 *
 * Master prompt Section 8, and the hardest constraint in the system:
 *
 *   "Order and Transaction state changes must be transactional -- a payment
 *    confirmation and an order-status update should never be able to
 *    desync, especially with COD-to-digital reconciliation."
 *
 * This exists so that requirement is structural rather than a convention
 * people remember. A caller cannot write an Order without being handed a
 * transaction context, because the repository methods only accept one.
 *
 * ADR-0002 (modular monolith) is what makes this affordable: the whole
 * order-creation path is one local database transaction. Split across
 * services it would need a saga and compensating writes -- machinery whose
 * only purpose is undoing a split we chose voluntarily.
 */

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

/**
 * An open transaction. Repositories take this rather than reaching for a
 * pool connection, which is what prevents an accidental auto-commit write
 * partway through a compliance-bearing sequence.
 */
export interface TransactionContext {
  /**
   * Execute a parameterised statement inside this transaction.
   *
   * Parameters are always bound, never interpolated.
   */
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface UnitOfWork {
  /**
   * Run `work` inside a single database transaction.
   *
   * Commits when `work` resolves; rolls back and rethrows when it rejects.
   * Nesting reuses the outer transaction rather than opening a second one --
   * a nested BEGIN would silently break atomicity for the outer caller.
   */
  withTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}
