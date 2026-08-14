/**
 * Notification module. Owns notification_outbox.
 *
 * Stateless from the caller's perspective: other modules enqueue through
 * NOTIFICATION_PORT and never touch the table.
 */

import { Global, Module } from '@nestjs/common';

import { NOTIFICATION_PORT } from '../common/ports/notification.port';

import {
  LoggingPushGateway,
  LoggingSmsGateway,
  PUSH_GATEWAY,
  SMS_GATEWAY,
} from './gateways';
import { NotificationAdapter } from './notification.adapter';
import { NotificationDispatcher } from './notification.dispatcher';
import { NotificationRepository } from './notification.repository';

@Global()
@Module({
  providers: [
    NotificationRepository,
    NotificationAdapter,
    NotificationDispatcher,
    { provide: NOTIFICATION_PORT, useExisting: NotificationAdapter },
    { provide: SMS_GATEWAY, useClass: LoggingSmsGateway },
    { provide: PUSH_GATEWAY, useClass: LoggingPushGateway },
  ],
  exports: [NOTIFICATION_PORT, NotificationDispatcher],
})
export class NotificationModule {}
