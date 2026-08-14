/**
 * Marks a route as reachable without a session.
 *
 * Only login endpoints and the aggregator webhook should carry this. The
 * webhook authenticates by HMAC signature instead, which is the only
 * credential an external payment provider can present.
 */

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC, true);
