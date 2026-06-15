import type { ConfigService } from '@nestjs/config'
import type { InferConfig, InferProcessEnv } from './index'
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { defineConfig } from './index'

const _config = defineConfig({
  port: z.number().default(3000),
  flag: z.boolean(),
  database: { url: z.string(), poolSize: z.number() },
  creds: z.union([z.string(), z.object({ id: z.string() })]).optional(),
})

type Config = InferConfig<typeof _config>
type Env = InferProcessEnv<typeof _config>

describe('InferConfig', () => {
  it('infers a scalar leaf type', () => {
    expectTypeOf<Config['port']>().toEqualTypeOf<number>()
  })

  it('infers a boolean leaf type', () => {
    expectTypeOf<Config['flag']>().toEqualTypeOf<boolean>()
  })

  it('infers a nested object leaf type', () => {
    expectTypeOf<Config['database']>().toEqualTypeOf<{ url: string, poolSize: number }>()
  })

  it('infers an optional union leaf as the branch union plus undefined', () => {
    expectTypeOf<Config['creds']>().toEqualTypeOf<string | { id: string } | undefined>()
  })

  it('narrows a defaulted leaf to a defined type', () => {
    expectTypeOf<Config['port']>().not.toEqualTypeOf<number | undefined>()
  })
})

describe('InferProcessEnv', () => {
  it('flattens shape keys to UPPER_SNAKE_CASE env keys', () => {
    expectTypeOf<keyof Env>().toEqualTypeOf<'PORT' | 'FLAG' | 'DATABASE_URL' | 'DATABASE_POOL_SIZE' | 'CREDS'>()
  })

  it('types a required leaf as string', () => {
    expectTypeOf<Env['FLAG']>().toEqualTypeOf<string>()
    expectTypeOf<Env['DATABASE_URL']>().toEqualTypeOf<string>()
    expectTypeOf<Env['DATABASE_POOL_SIZE']>().toEqualTypeOf<string>()
  })

  it('widens a defaulted leaf to string | undefined', () => {
    expectTypeOf<Env['PORT']>().toEqualTypeOf<string | undefined>()
  })

  it('widens an optional leaf to string | undefined', () => {
    expectTypeOf<Env['CREDS']>().toEqualTypeOf<string | undefined>()
  })
})

describe('ConfigService<InferConfig, true>', () => {
  it('infers the value type of get(path, { infer: true }) from the path', () => {
    function _check(cs: ConfigService<Config, true>): void {
      expectTypeOf(cs.get('port', { infer: true })).toBeNumber()
      expectTypeOf(cs.get('database.url', { infer: true })).toBeString()
    }

    void _check
  })
})

describe('InferProcessEnv env-key mapping', () => {
  const _camel = defineConfig({
    apiKey: z.string(),
    googleApplicationCredentials: z.string(),
    nodeEnv: z.string(),
  })

  it('maps camelCase keys to UPPER_SNAKE_CASE', () => {
    expectTypeOf<keyof InferProcessEnv<typeof _camel>>()
      .toEqualTypeOf<'API_KEY' | 'GOOGLE_APPLICATION_CREDENTIALS' | 'NODE_ENV'>()
  })

  it('keeps a numeric shape key', () => {
    const _numeric = defineConfig({ 0: z.string() })

    expectTypeOf<keyof InferProcessEnv<typeof _numeric>>().toEqualTypeOf<'0'>()
  })

  it('resolves an empty shape to no env keys', () => {
    const _empty = defineConfig({})

    expectTypeOf<keyof InferProcessEnv<typeof _empty>>().toEqualTypeOf<never>()
  })
})
