/**
 * Redis client.
 *
 * Used for rate limiting and OTP challenge storage. Both are legitimately
 * ephemeral: an OTP that vanishes because Redis restarted is a re-request,
 * not lost data. Anything that must survive belongs in Postgres.
 */

import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: async (config: ConfigService): Promise<RedisClientType> => {
    const url = config.get<string>('REDIS_URL');

    if (!url) {
      throw new Error('REDIS_URL is not configured');
    }

    const client: RedisClientType = createClient({ url });

    // Do not let a Redis error crash the process: both users of this client
    // degrade gracefully (rate limiter fails open, OTP issuance surfaces an
    // error to the caller).
    client.on('error', () => undefined);

    await client.connect();

    return client;
  },
};
