import type { StandardSchemaV1 } from '@standard-schema/spec'
import { type } from 'arktype'
import * as v from 'valibot'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { expected, validators, validEnv } from '../test/fixtures/schemas'
import { defineConfig } from './define-config'
import { ConfigValidationError } from './errors'

function fakeSchema(validate: () => unknown): StandardSchemaV1 {
  return { '~standard': { version: 1, vendor: 'fake', validate } } as StandardSchemaV1
}

function captureError(fn: () => unknown): ConfigValidationError {
  try {
    fn()
  }
  catch (error) {
    return error as ConfigValidationError
  }
  throw new Error('expected validate to throw')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('defineConfig', () => {
  describe.each(validators)('across every supported validator ($name)', ({ shape }) => {
    it('validates a complete environment into a typed config object', () => {
      expect(defineConfig(shape).validate(validEnv)).toEqual(expected)
    })

    it('coerces numeric and boolean env strings to their real types', () => {
      const config = defineConfig(shape).validate(validEnv) as typeof expected

      expect(typeof config.port).toBe('number')
      expect(typeof config.debug).toBe('boolean')
      expect(typeof config.database.poolSize).toBe('number')
    })

    it('leaves string-typed leaves as strings', () => {
      const config = defineConfig(shape).validate(validEnv) as typeof expected

      expect(typeof config.database.url).toBe('string')
    })

    it('throws ConfigValidationError when a required env var is missing', () => {
      const { PORT, ...withoutPort } = validEnv

      expect(() => defineConfig(shape).validate(withoutPort)).toThrow(ConfigValidationError)
    })

    it('throws ConfigValidationError when an env var fails its schema', () => {
      expect(() => defineConfig(shape).validate({ ...validEnv, PORT: 'not-a-number' }))
        .toThrow(ConfigValidationError)
    })
  })

  describe('env-key mapping', () => {
    it('maps a nested camelCase key to an underscore-joined UPPER_SNAKE_CASE var', () => {
      const { validate } = defineConfig({ database: { poolSize: z.number() } })

      expect(validate({ DATABASE_POOL_SIZE: '5' })).toEqual({ database: { poolSize: 5 } })
    })

    it('maps a single camelCase key to UPPER_SNAKE_CASE', () => {
      const { validate } = defineConfig({ titleModel: z.string() })

      expect(validate({ TITLE_MODEL: 'gpt' })).toEqual({ titleModel: 'gpt' })
    })

    it('maps multi-word and consecutive-capital keys correctly', () => {
      const { validate } = defineConfig({ apiKey: z.string(), googleApplicationCredentials: z.string() })

      expect(validate({ API_KEY: 'k', GOOGLE_APPLICATION_CREDENTIALS: '/path' }))
        .toEqual({ apiKey: 'k', googleApplicationCredentials: '/path' })
    })

    it('joins prefixes for a deeply nested leaf', () => {
      const { validate } = defineConfig({ mail: { auth: { user: z.string() } } })

      expect(validate({ MAIL_AUTH_USER: 'me' })).toEqual({ mail: { auth: { user: 'me' } } })
    })

    it('joins env prefixes across three levels of nesting', () => {
      const { validate } = defineConfig({ database: { pool: { maxIdleTime: z.number() } } })

      expect(validate({ DATABASE_POOL_MAX_IDLE_TIME: '30000' }))
        .toEqual({ database: { pool: { maxIdleTime: 30000 } } })
    })

    it('ignores env vars not declared in the shape', () => {
      const { validate } = defineConfig({ port: z.number() })

      expect(validate({ PORT: '3000', PATH: '/usr/bin', HOME: '/root' })).toEqual({ port: 3000 })
    })
  })

  describe('env-key collisions', () => {
    it('throws at definition time when two leaves map to the same env key', () => {
      expect(() => defineConfig({ appKey: z.string(), app: { key: z.string() } })).toThrow(/APP_KEY/)
    })

    it('names both colliding paths in the error', () => {
      expect(() => defineConfig({ aB: z.string(), a: { b: z.string() } }))
        .toThrow(/"a\.b".*"aB"|"aB".*"a\.b"/)
    })

    it('does not throw for distinct env keys', () => {
      expect(() => defineConfig({ a: { b: z.string() }, c: z.string() })).not.toThrow()
    })
  })

  describe('whitespace-only values', () => {
    it('treats a whitespace-only value as missing so a default applies', () => {
      const { validate } = defineConfig({ port: z.coerce.number().default(3000) })

      expect(validate({ PORT: '   ' })).toEqual({ port: 3000 })
    })

    it('resolves an optional leaf to undefined for a whitespace-only value', () => {
      const { validate } = defineConfig({ token: z.string().optional() })

      expect(validate({ TOKEN: '  ' })).toEqual({ token: undefined })
    })

    it('applies a default for a whitespace-only value when coerce is false', () => {
      const { validate } = defineConfig({ port: z.string().default('fallback') }, { coerce: false })

      expect(validate({ PORT: '   ' })).toEqual({ port: 'fallback' })
    })
  })

  describe('defaults and optionals', () => {
    it('treats an empty string as missing so a default applies', () => {
      const { validate } = defineConfig({ port: z.number().default(3000) })

      expect(validate({ PORT: '' })).toEqual({ port: 3000 })
    })

    it('treats a missing env var as missing so a default applies', () => {
      const { validate } = defineConfig({ port: z.number().default(3000) })

      expect(validate({})).toEqual({ port: 3000 })
    })

    it('resolves an optional leaf to undefined for an empty string', () => {
      const { validate } = defineConfig({ token: z.string().optional() })

      expect(validate({ TOKEN: '' })).toEqual({ token: undefined })
    })

    it('applies a default to a nested leaf', () => {
      const { validate } = defineConfig({ database: { poolSize: z.number().default(10) } })

      expect(validate({})).toEqual({ database: { poolSize: 10 } })
    })
  })

  describe('the coerce option', () => {
    it('coerces env strings by default', () => {
      const { validate } = defineConfig({ port: z.number() })

      expect(validate({ PORT: '8080' })).toEqual({ port: 8080 })
    })

    it('keeps env strings raw when coerce is false', () => {
      const { validate } = defineConfig({ port: z.string() }, { coerce: false })

      expect(validate({ PORT: '8080' })).toEqual({ port: '8080' })
    })

    it('still treats an empty string as missing when coerce is false', () => {
      const { validate } = defineConfig({ port: z.string().default('fallback') }, { coerce: false })

      expect(validate({ PORT: '' })).toEqual({ port: 'fallback' })
    })

    it('passes the raw string to schema-level coercion when coerce is false', () => {
      const { validate } = defineConfig({ port: z.coerce.number() }, { coerce: false })

      expect(validate({ PORT: '42' })).toEqual({ port: 42 })
    })

    it('throws when coerce is false and an object leaf receives a raw string', () => {
      const { validate } = defineConfig({ creds: z.object({ id: z.string() }) }, { coerce: false })

      expect(() => validate({ CREDS: '{"id":"x"}' })).toThrow(ConfigValidationError)
    })
  })

  describe('coercing all-digit string secrets', () => {
    it('rejects an all-digit secret under a plain string schema', () => {
      const { validate } = defineConfig({ apiKey: z.string() })

      expect(() => validate({ API_KEY: '1234567890' })).toThrow(ConfigValidationError)
    })

    it('preserves an all-digit secret under a coercing string schema', () => {
      const { validate } = defineConfig({ apiKey: z.coerce.string() })

      expect(validate({ API_KEY: '1234567890' })).toEqual({ apiKey: '1234567890' })
    })

    it('preserves an all-digit secret when coerce is false', () => {
      const { validate } = defineConfig({ apiKey: z.string() }, { coerce: false })

      expect(validate({ API_KEY: '1234567890' })).toEqual({ apiKey: '1234567890' })
    })
  })

  describe('object, array, and record leaves from one env var', () => {
    it('parses a zod object leaf from one JSON env var', () => {
      const { validate } = defineConfig({ creds: z.object({ project_id: z.string(), client_email: z.string() }) })

      expect(validate({ CREDS: JSON.stringify({ project_id: 'p', client_email: 'a@b.c' }) }))
        .toEqual({ creds: { project_id: 'p', client_email: 'a@b.c' } })
    })

    it('parses a valibot object leaf from one JSON env var', () => {
      const { validate } = defineConfig({ creds: v.object({ project_id: v.string() }) })

      expect(validate({ CREDS: JSON.stringify({ project_id: 'p' }) })).toEqual({ creds: { project_id: 'p' } })
    })

    it('parses an arktype object leaf from one JSON env var', () => {
      const { validate } = defineConfig({ creds: type({ project_id: 'string' }) })

      expect(validate({ CREDS: JSON.stringify({ project_id: 'p' }) })).toEqual({ creds: { project_id: 'p' } })
    })

    it('parses an array leaf from one JSON env var', () => {
      const { validate } = defineConfig({ origins: z.array(z.string()) })

      expect(validate({ ORIGINS: '["https://a.com","https://b.com"]' }))
        .toEqual({ origins: ['https://a.com', 'https://b.com'] })
    })

    it('parses a record leaf from one JSON env var', () => {
      const { validate } = defineConfig({ features: z.record(z.string(), z.boolean()) })

      expect(validate({ FEATURES: '{"beta":true,"legacy":false}' }))
        .toEqual({ features: { beta: true, legacy: false } })
    })
  })

  describe('union leaves', () => {
    const config = defineConfig({
      credentials: z.union([z.string(), z.object({ project_id: z.string(), client_email: z.string() })]).optional(),
    })

    it('accepts the string branch of a union', () => {
      expect(config.validate({ CREDENTIALS: '/path/creds.json' })).toEqual({ credentials: '/path/creds.json' })
    })

    it('parses the object branch of a union from JSON', () => {
      expect(config.validate({ CREDENTIALS: JSON.stringify({ project_id: 'p', client_email: 'e' }) }))
        .toEqual({ credentials: { project_id: 'p', client_email: 'e' } })
    })

    it('omits an absent optional union', () => {
      expect(config.validate({})).toEqual({ credentials: undefined })
    })
  })

  describe('error reporting', () => {
    const shape = {
      port: z.number(),
      database: { url: z.string(), poolSize: z.number() },
    }

    it('reports one issue per failing leaf', () => {
      const error = captureError(() =>
        defineConfig(shape).validate({ PORT: 'x', DATABASE_URL: '', DATABASE_POOL_SIZE: 'y' }))

      expect(error.issues.map(i => i.path).sort()).toEqual(['database.poolSize', 'database.url', 'port'])
    })

    it('reports a path, env var, and non-empty message for every issue', () => {
      const error = captureError(() =>
        defineConfig(shape).validate({ PORT: 'x', DATABASE_URL: 'ok', DATABASE_POOL_SIZE: 'y' }))
      const byPath = Object.fromEntries(error.issues.map(i => [i.path, i]))

      expect(byPath.port.env).toBe('PORT')
      expect(byPath.port.message).toBeTruthy()
      expect(byPath['database.poolSize'].env).toBe('DATABASE_POOL_SIZE')
      expect(byPath['database.poolSize'].message).toBeTruthy()
    })

    it('formats the error message as one line per issue', () => {
      const error = captureError(() =>
        defineConfig(shape).validate({ PORT: 'x', DATABASE_URL: 'ok', DATABASE_POOL_SIZE: '1' }))
      const lines = error.message.split('\n')

      expect(lines).toHaveLength(2)
      expect(lines[0]).toBe('Config validation failed:')
      expect(lines[1]).toMatch(/^ {2}- port: .+ \(env: PORT\)$/)
    })

    it('surfaces the joined env key on a nested leaf issue', () => {
      const error = captureError(() => defineConfig({ mail: { auth: { user: z.string() } } }).validate({}))

      expect(error.issues[0].path).toBe('mail.auth.user')
      expect(error.issues[0].env).toBe('MAIL_AUTH_USER')
    })

    it('reports a sub-field issue path under the env key for a zod object leaf', () => {
      const config = defineConfig({ creds: z.object({ project_id: z.string() }) })
      const error = captureError(() => config.validate({ CREDS: JSON.stringify({ project_id: 123 }) }))

      expect(error.issues[0].path).toBe('creds.project_id')
      expect(error.issues[0].env).toBe('CREDS')
    })

    it('reports a sub-field issue path under the env key for a valibot object leaf', () => {
      const config = defineConfig({ creds: v.object({ project_id: v.string() }) })
      const error = captureError(() => config.validate({ CREDS: JSON.stringify({ project_id: 123 }) }))

      expect(error.issues[0].path).toBe('creds.project_id')
      expect(error.issues[0].env).toBe('CREDS')
    })

    it('reports a single top-level issue when no union branch matches', () => {
      const config = defineConfig({ credentials: z.union([z.string(), z.object({ id: z.string() })]) })
      const error = captureError(() => config.validate({ CREDENTIALS: '{"wrong":true}' }))

      expect(error.issues).toHaveLength(1)
      expect(error.issues[0].path).toBe('credentials')
      expect(error.issues[0].env).toBe('CREDENTIALS')
    })

    it('exposes the validator-native issue via issue.raw', () => {
      const error = captureError(() => defineConfig({ port: z.number() }).validate({ PORT: 'abc' }))

      expect((error.issues[0].raw as { code?: string }).code).toBe('invalid_type')
    })

    it('synthesizes a raw issue when the validator returns no issue detail', () => {
      const error = captureError(() => defineConfig({ x: fakeSchema(() => ({ issues: [] })) }).validate({ X: 'a' }))

      expect(error.issues[0].raw.message).toBe('Invalid value.')
    })

    it('exposes the raw issues as the error cause', () => {
      const error = captureError(() => defineConfig({ port: z.number() }).validate({ PORT: 'abc' }))

      expect(error.cause).toEqual(error.issues.map(i => i.raw))
    })

    it('renders an array-index issue path with bracket notation', () => {
      const error = captureError(() =>
        defineConfig({ origins: z.array(z.string()) }).validate({ ORIGINS: '["ok",123]' }))

      expect(error.issues[0].path).toBe('origins[1]')
    })
  })

  describe('synchronous-only validation', () => {
    it('throws a TypeError mentioning "synchronous" when a schema returns a Promise', () => {
      const { validate } = defineConfig({ name: z.string().refine(async () => true) })

      expect(() => validate({ NAME: 'x' })).toThrow(TypeError)
      expect(() => validate({ NAME: 'x' })).toThrow(/synchronous/i)
    })

    it('treats a thenable result as async and throws', () => {
      const { validate } = defineConfig({ x: fakeSchema(() => ({ then: () => {} })) })

      expect(() => validate({ X: 'a' })).toThrow(/synchronous/i)
    })

    it('treats a callable thenable result as async and throws', () => {
      const { validate } = defineConfig({ x: fakeSchema(() => Object.assign(() => {}, { then: () => {} })) })

      expect(() => validate({ X: 'a' })).toThrow(/synchronous/i)
    })
  })

  describe('invalid shape nodes', () => {
    it('throws a TypeError for a leaf that is neither a schema nor an object', () => {
      const { validate } = defineConfig({ x: 123 as unknown as StandardSchemaV1 })

      expect(() => validate({})).toThrow(TypeError)
      expect(() => validate({})).toThrow(/Invalid config shape at "x"/)
    })

    it('throws a TypeError for a node that is not a Standard Schema', () => {
      const { validate } = defineConfig({ port: type('number').default(3000) as unknown as StandardSchemaV1 })

      expect(() => validate({})).toThrow(/Invalid config shape/)
    })

    it('reports the dotted path of the invalid node', () => {
      const { validate } = defineConfig({ a: { b: 'oops' as unknown as StandardSchemaV1 } })

      expect(() => validate({})).toThrow(/Invalid config shape at "a\.b"/)
    })
  })

  describe('namespaced load factories and shared cache', () => {
    const shape = {
      port: z.number(),
      database: { url: z.string(), poolSize: z.number() },
      redis: { url: z.string() },
    }
    const fullEnv = { PORT: '8080', DATABASE_URL: 'postgres://db', DATABASE_POOL_SIZE: '10', REDIS_URL: 'redis://r' }

    it('produces one factory per top-level key', () => {
      expect(defineConfig(shape).load).toHaveLength(3)
    })

    it('namespaces each factory token by its top-level key', () => {
      const keys = defineConfig(shape).load.map(f => f.KEY).sort()

      expect(keys).toEqual(['CONFIGURATION(database)', 'CONFIGURATION(port)', 'CONFIGURATION(redis)'])
    })

    it('returns its own namespace slice from each factory', () => {
      const { validate, load } = defineConfig(shape)
      validate(fullEnv)
      const byKey = Object.fromEntries(load.map(f => [f.KEY, f()]))

      expect(byKey['CONFIGURATION(port)']).toBe(8080)
      expect(byKey['CONFIGURATION(database)']).toEqual({ url: 'postgres://db', poolSize: 10 })
      expect(byKey['CONFIGURATION(redis)']).toEqual({ url: 'redis://r' })
    })

    it('reuses the cached parse shared with validate', () => {
      const { validate, load } = defineConfig(shape)
      const parsed = validate(fullEnv)
      const dbFactory = load.find(f => f.KEY === 'CONFIGURATION(database)')!

      expect(dbFactory()).toBe(parsed.database)
    })

    describe('without a prior validate call', () => {
      beforeEach(() => {
        vi.stubEnv('PORT', '3000')
        vi.stubEnv('DATABASE_URL', 'postgres://lazy')
        vi.stubEnv('DATABASE_POOL_SIZE', '7')
        vi.stubEnv('REDIS_URL', 'redis://lazy')
      })

      it('lazily parses process.env on first access', () => {
        const portFactory = defineConfig(shape).load.find(f => f.KEY === 'CONFIGURATION(port)')!

        expect(portFactory()).toBe(3000)
      })

      it('throws ConfigValidationError when process.env is invalid', () => {
        vi.stubEnv('PORT', 'not-a-number')
        const portFactory = defineConfig(shape).load.find(f => f.KEY === 'CONFIGURATION(port)')!

        expect(() => void portFactory()).toThrow(ConfigValidationError)
      })
    })
  })

  describe('cache invalidation', () => {
    it('does not serve a stale value through load after a failed re-validation', () => {
      const config = defineConfig({ port: z.number() })
      config.validate({ PORT: '1' })

      expect(() => config.validate({ PORT: 'not-a-number' })).toThrow(ConfigValidationError)

      vi.stubEnv('PORT', '2')
      const portFactory = config.load.find(f => f.KEY === 'CONFIGURATION(port)')!

      expect(portFactory()).toBe(2)
    })

    it('refreshes the cache on a successful re-validation', () => {
      const config = defineConfig({ port: z.number() })
      const portFactory = config.load[0]

      config.validate({ PORT: '1' })
      expect(portFactory()).toBe(1)

      config.validate({ PORT: '2' })
      expect(portFactory()).toBe(2)
    })
  })
})
