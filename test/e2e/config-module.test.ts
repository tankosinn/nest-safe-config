import type { TestingModule } from '@nestjs/testing'
import type { ConfigShape, InferConfig } from '../../src'
import { Inject, Injectable, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineConfig } from '../../src'
import { expected, validators, validEnv } from '../fixtures/schemas'

function stubEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env))
    vi.stubEnv(key, value)
}

async function bootModule(shape: ConfigShape): Promise<TestingModule> {
  const config = defineConfig(shape)
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        validate: config.validate,
        load: config.load,
        isGlobal: true,
        cache: true,
        ignoreEnvFile: true,
      }),
    ],
  }).compile()
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ConfigModule integration', () => {
  describe.each(validators)('across every supported validator ($name)', ({ shape }) => {
    beforeEach(() => {
      stubEnv(validEnv)
    })

    it('exposes every validated, coerced leaf through ConfigService', async () => {
      const cs = (await bootModule(shape)).get(ConfigService)

      expect(cs.get('nodeEnv')).toBe(expected.nodeEnv)
      expect(cs.get('port')).toBe(expected.port)
      expect(cs.get('debug')).toBe(expected.debug)
      expect(cs.get('database.url')).toBe(expected.database.url)
      expect(cs.get('database.poolSize')).toBe(expected.database.poolSize)
      expect(cs.get('redis.url')).toBe(expected.redis.url)
    })

    it('resolves each namespaced factory by its CONFIGURATION token', async () => {
      const moduleRef = await bootModule(shape)

      expect(moduleRef.get<typeof expected.database>('CONFIGURATION(database)')).toEqual(expected.database)
      expect(moduleRef.get<typeof expected.redis>('CONFIGURATION(redis)')).toEqual(expected.redis)
    })

    it('reads a namespace slice through ConfigService by dotted path', async () => {
      const cs = (await bootModule(shape)).get(ConfigService)

      expect(cs.get('database')).toEqual(expected.database)
    })
  })

  describe.each(validators)('invalid environment ($name)', ({ shape }) => {
    it('aborts bootstrap when a required var is missing', async () => {
      stubEnv({ ...validEnv, DATABASE_URL: '' })

      await expect(bootModule(shape)).rejects.toThrow(/DATABASE_URL/)
    })

    it('aborts bootstrap when a var fails its schema', async () => {
      stubEnv({ ...validEnv, PORT: 'not-a-number' })

      await expect(bootModule(shape)).rejects.toThrow(/PORT/)
    })

    it('reports every offending var at once', async () => {
      stubEnv({ ...validEnv, DATABASE_URL: '', REDIS_URL: '' })

      await expect(bootModule(shape)).rejects.toThrow(/DATABASE_URL/)
      await expect(bootModule(shape)).rejects.toThrow(/REDIS_URL/)
    })
  })

  describe('dependency injection', () => {
    it('injects a ConfigService typed by the inferred config into a provider', async () => {
      stubEnv({ PORT: '8080', DATABASE_URL: 'postgres://localhost/app' })

      const config = defineConfig({
        port: z.number(),
        database: { url: z.string() },
      })

      @Injectable()
      class AppService {
        constructor(
          @Inject(ConfigService)
          private readonly cs: ConfigService<InferConfig<typeof config>, true>,
        ) {}

        get port(): number {
          return this.cs.get('port', { infer: true })
        }

        get databaseUrl(): string {
          return this.cs.get('database.url', { infer: true })
        }
      }

      @Module({
        imports: [
          ConfigModule.forRoot({
            validate: config.validate,
            load: config.load,
            isGlobal: true,
            cache: true,
            ignoreEnvFile: true,
          }),
        ],
        providers: [AppService],
      })
      class AppModule {}

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
      await moduleRef.init()

      const service = moduleRef.get(AppService)
      expect(service.port).toBe(8080)
      expect(service.databaseUrl).toBe('postgres://localhost/app')

      await moduleRef.close()
    })
  })
})
