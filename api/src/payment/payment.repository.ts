/**
 * Payment repository.
 *
 * `payment` owns the `transaction` table.
 *
 * Every method takes a TransactionContext: a settlement write and the order
 * status change it triggers must commit together or not at all.
 */

import { Injectable } from '@nestjs/common';

import { TransactionContext } from '../common/database/unit-of-work';

export interface TransactionRow {
  id: string;
  order_id: string;
  method: string;
  amount_bdt: string;
  status: string;
  aggregator: string | null;
  aggregator_ref: string | null;
  is_advance: boolean;
  settled_at: Date | null;
}

@Injectable()
export class PaymentRepository {
  /**
   * Look up a transaction by its aggregator reference.
   *
   * This is the idempotency check. Aggregators retry webhooks -- a duplicate
   * must be recognised and ignored, not processed twice.
   */
  async findByAggregatorRef(
    tx: TransactionContext,
    aggregator: string,
    ref: string,
  ): Promise<TransactionRow | null> {
    const rows = await tx.query<TransactionRow>(
      `SELECT id, order_id, method, amount_bdt, status,
              aggregator, aggregator_ref, is_advance, settled_at
         FROM transaction
        WHERE aggregator = $1 AND aggregator_ref = $2`,
      [aggregator, ref],
    );

    return rows[0] ?? null;
  }

  /** The pending row created alongside the order, awaiting settlement. */
  async findPendingForOrder(
    tx: TransactionContext,
    orderId: string,
  ): Promise<TransactionRow | null> {
    const rows = await tx.query<TransactionRow>(
      `SELECT id, order_id, method, amount_bdt, status,
              aggregator, aggregator_ref, is_advance, settled_at
         FROM transaction
        WHERE order_id = $1 AND status = 'pending'
        ORDER BY occurred_at
        LIMIT 1`,
      [orderId],
    );

    return rows[0] ?? null;
  }

  /**
   * Mark a transaction settled and record the aggregator reference.
   *
   * Writing the ref here is what arms the UNIQUE (aggregator, aggregator_ref)
   * constraint against replays: a second webhook carrying the same ref is
   * caught by findByAggregatorRef, and if two arrive concurrently the
   * database constraint rejects the loser.
   */
  async markSettled(
    tx: TransactionContext,
    transactionId: string,
    aggregator: string,
    ref: string,
    settledAt: Date,
  ): Promise<void> {
    await tx.query(
      `UPDATE transaction
          SET status = 'settled',
              aggregator = $2,
              aggregator_ref = $3,
              settled_at = $4
        WHERE id = $1`,
      [transactionId, aggregator, ref, settledAt],
    );
  }

  async markFailed(
    tx: TransactionContext,
    transactionId: string,
    aggregator: string,
    ref: string,
  ): Promise<void> {
    await tx.query(
      `UPDATE transaction
          SET status = 'failed', aggregator = $2, aggregator_ref = $3
        WHERE id = $1`,
      [transactionId, aggregator, ref],
    );
  }
}
