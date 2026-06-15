import type { ConfigShape } from '../../src'
import { type } from 'arktype'
import * as v from 'valibot'
import { z } from 'zod'

export const validators: ReadonlyArray<{ name: string, shape: ConfigShape }> = [
  {
    name: 'zod',
    shape: {
      nodeEnv: z.enum(['development', 'production', 'test']),
      port: z.number(),
      debug: z.boolean(),
      database: { url: z.string(), poolSize: z.number() },
      redis: { url: z.string() },
    },
  },
  {
    name: 'valibot',
    shape: {
      nodeEnv: v.picklist(['development', 'production', 'test']),
      port: v.number(),
      debug: v.boolean(),
      database: { url: v.string(), poolSize: v.number() },
      redis: { url: v.string() },
    },
  },
  {
    name: 'arktype',
    shape: {
      nodeEnv: type('\'development\' | \'production\' | \'test\''),
      port: type('number'),
      debug: type('boolean'),
      database: { url: type('string'), poolSize: type('number') },
      redis: { url: type('string') },
    },
  },
]

export const validEnv: Record<string, string> = {
  NODE_ENV: 'production',
  PORT: '8080',
  DEBUG: 'true',
  DATABASE_URL: 'postgres://localhost/app',
  DATABASE_POOL_SIZE: '10',
  REDIS_URL: 'redis://localhost',
}

export const expected = {
  nodeEnv: 'production',
  port: 8080,
  debug: true,
  database: { url: 'postgres://localhost/app', poolSize: 10 },
  redis: { url: 'redis://localhost' },
}
