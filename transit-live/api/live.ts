import { readFileSync } from 'node:fs';
import { getCache } from '@vercel/functions';
import { validateSchedule } from '../generated/transit/schedule.ts';
import { createHandler } from '../src/service.ts';
import { Sources, type SharedCache } from '../src/source.ts';

let handler: ReturnType<typeof createHandler> | undefined;

export default {
  async fetch(request: Request): Promise<Response> {
    if (!handler) {
      const schedule = validateSchedule(
        JSON.parse(readFileSync(new URL('../generated/schedule.json', import.meta.url), 'utf8')),
      );
      const cache = getCache({ namespace: 'nexo-transit-live-v1' });
      const adapter: SharedCache = {
        get: (key) => cache.get(key),
        set: async (key, value, options) => {
          await cache.set(key, value, options);
        },
      };
      handler = createHandler(schedule, new Sources(adapter), {
        tokenHash: process.env.TRANSIT_TOKEN_SHA256,
        enabled:
          process.env.TRANSIT_DISABLED !== '1' &&
          (process.env.VERCEL !== '1' || process.env.TRANSIT_WAF_READY === '1'),
        webOrigin: process.env.TRANSIT_WEB_ORIGIN,
      });
    }
    return handler(request);
  },
};
