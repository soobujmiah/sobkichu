/**
 * Dispatcher tests.
 *
 * The behaviours that matter: a gateway failure must not lose the
 * notification, one failure must not take down the rest of the batch, and a
 * permanently failing message must eventually stop retrying while staying
 * visible as evidence.
 */

import { TransactionContext, UnitOfWork } from '../common/database/unit-of-work';

import { PushGateway, SmsGateway } from './gateways';
import { NotificationDispatcher } from './notification.dispatcher';
import { NotificationRepository, OutboxRow } from './notification.repository';

const row = (overrides: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 'n1',
  user_id: 'u1',
  phone_e164: '+8801700000001',
  language: 'bn',
  channel: 'sms',
  template_key: 'notification.order.confirmed',
  params: { orderRef: 'abc12345' },
  order_id: 'o1',
  status: 'pending',
  attempts: 0,
  ...overrides,
});

class FakeUow implements UnitOfWork {
  count = 0;
  async withTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    this.count += 1;
    return work({ query: async () => [] });
  }
}

class FakeRepo extends NotificationRepository {
  sent: string[] = [];
  failed: Array<{ id: string; error: string }> = [];

  constructor(private readonly pending: OutboxRow[]) {
    super();
  }

  override async claimPending() {
    return this.pending;
  }

  override async markSent(_tx: TransactionContext, id: string) {
    this.sent.push(id);
  }

  override async markFailed(_tx: TransactionContext, id: string, error: string) {
    this.failed.push({ id, error });
  }
}

class RecordingSms implements SmsGateway {
  sent: Array<{ phone: string; body: string }> = [];
  constructor(private readonly failOn: string[] = []) {}

  async send(phoneE164: string, body: string) {
    if (this.failOn.includes(phoneE164)) {
      throw new Error('gateway unavailable');
    }
    this.sent.push({ phone: phoneE164, body });
  }
}

class RecordingPush implements PushGateway {
  sent: string[] = [];
  async send(userId: string) {
    this.sent.push(userId);
  }
}

describe('NotificationDispatcher', () => {
  it('sends a pending SMS and marks it sent', async () => {
    const repo = new FakeRepo([row()]);
    const sms = new RecordingSms();
    const dispatcher = new NotificationDispatcher(
      new FakeUow(),
      sms,
      new RecordingPush(),
      repo,
    );

    const summary = await dispatcher.dispatchBatch();

    expect(summary).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(sms.sent[0].phone).toBe('+8801700000001');
    // Rendered in the recipient's language, not English by default.
    expect(sms.sent[0].body).toMatch(/[\u0980-\u09FF]/);
    expect(repo.sent).toEqual(['n1']);
  });

  it('routes push rows to the push gateway', async () => {
    const repo = new FakeRepo([row({ id: 'n2', channel: 'push' })]);
    const push = new RecordingPush();
    const dispatcher = new NotificationDispatcher(
      new FakeUow(),
      new RecordingSms(),
      push,
      repo,
    );

    await dispatcher.dispatchBatch();

    expect(push.sent).toEqual(['u1']);
  });

  it('keeps a failed notification for retry rather than losing it', async () => {
    const repo = new FakeRepo([row()]);
    const dispatcher = new NotificationDispatcher(
      new FakeUow(),
      new RecordingSms(['+8801700000001']),
      new RecordingPush(),
      repo,
    );

    const summary = await dispatcher.dispatchBatch();

    expect(summary).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(repo.sent).toEqual([]);
    expect(repo.failed[0]).toEqual({ id: 'n1', error: 'gateway unavailable' });
  });

  it('continues the batch after one failure', async () => {
    // One transaction for the whole batch would roll back the successes too,
    // producing duplicates on retry.
    const repo = new FakeRepo([
      row({ id: 'n1', phone_e164: '+8801700000001' }),
      row({ id: 'n2', phone_e164: '+8801700000002' }),
      row({ id: 'n3', phone_e164: '+8801700000003' }),
    ]);
    const dispatcher = new NotificationDispatcher(
      new FakeUow(),
      new RecordingSms(['+8801700000002']),
      new RecordingPush(),
      repo,
    );

    const summary = await dispatcher.dispatchBatch();

    expect(summary).toEqual({ claimed: 3, sent: 2, failed: 1 });
    expect(repo.sent).toEqual(['n1', 'n3']);
  });

  it('treats a missing template as a failure, not a crash', async () => {
    const repo = new FakeRepo([row({ template_key: 'notification.nope' })]);
    const dispatcher = new NotificationDispatcher(
      new FakeUow(),
      new RecordingSms(),
      new RecordingPush(),
      repo,
    );

    const summary = await dispatcher.dispatchBatch();

    expect(summary.failed).toBe(1);
    expect(repo.failed[0].error).toContain('No template');
  });

  it('handles an empty queue without touching a gateway', async () => {
    const sms = new RecordingSms();
    const dispatcher = new NotificationDispatcher(
      new FakeUow(),
      sms,
      new RecordingPush(),
      new FakeRepo([]),
    );

    const summary = await dispatcher.dispatchBatch();

    expect(summary).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(sms.sent).toEqual([]);
  });

  it('sends each notification in its own transaction', async () => {
    const uow = new FakeUow();
    const dispatcher = new NotificationDispatcher(
      uow,
      new RecordingSms(),
      new RecordingPush(),
      new FakeRepo([row({ id: 'n1' }), row({ id: 'n2' })]),
    );

    await dispatcher.dispatchBatch();

    // One claim + one mark per notification.
    expect(uow.count).toBe(3);
  });
});
