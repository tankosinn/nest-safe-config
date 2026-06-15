import type { ConfigObject } from '@nestjs/config'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ConfigIssue } from './errors'
import type { ConfigShape, DefineConfigOptions, DefineConfigResult, InferConfig } from './types'
import process from 'node:process'
import { registerAs } from '@nestjs/config'
import { destr } from 'destr'
import { snakeCase } from 'scule'
import { ConfigValidationError } from './errors'

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    (typeof value === 'object' || typeof value === 'function')
    && value !== null
    && '~standard' in value
    && typeof (value as StandardSchemaV1)['~standard']?.validate === 'function'
  )
}

function isPlainObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null)
    return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function')
    && value !== null
    && typeof (value as { then?: unknown }).then === 'function'
  )
}

function toEnvKey(key: string): string {
  return snakeCase(key).toUpperCase()
}

function readValue(raw: unknown, coerce: boolean): unknown {
  if (raw === undefined)
    return undefined
  if (typeof raw === 'string' && raw.trim() === '')
    return undefined
  return coerce && typeof raw === 'string' ? destr(raw) : raw
}

function joinPath(base: string, segments: StandardSchemaV1.Issue['path']): string {
  if (!segments || segments.length === 0)
    return base
  return segments.reduce<string>((acc, seg) => {
    const key = typeof seg === 'object' ? seg.key : seg
    return typeof key === 'number' || (typeof key === 'string' && /^\d+$/.test(key))
      ? `${acc}[${String(key)}]`
      : `${acc}.${String(key)}`
  }, base)
}

function validateLeaf(
  schema: StandardSchemaV1,
  value: unknown,
  env: string,
  path: string,
  issues: ConfigIssue[],
): unknown {
  const result = schema['~standard'].validate(value)

  if (isPromiseLike(result)) {
    throw new TypeError(
      `Config validation must be synchronous, but the schema for "${env}" returned a Promise. `
      + 'Remove async refinements or transforms (e.g. Zod async .refine, Valibot *Async, ArkType async morphs).',
    )
  }

  if (result.issues) {
    if (result.issues.length === 0)
      issues.push({ path, env, message: 'Invalid value.', raw: { message: 'Invalid value.' } })
    for (const issue of result.issues)
      issues.push({ path: joinPath(path, issue.path), env, message: issue.message, raw: issue })
    return undefined
  }

  return result.value
}

function walk(
  shape: ConfigShape,
  env: Record<string, unknown>,
  coerce: boolean,
  envPrefix: string,
  pathPrefix: string,
  issues: ConfigIssue[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const [key, node] of Object.entries(shape)) {
    const envKey = envPrefix ? `${envPrefix}_${toEnvKey(key)}` : toEnvKey(key)
    const path = pathPrefix ? `${pathPrefix}.${key}` : key

    if (isStandardSchema(node))
      out[key] = validateLeaf(node, readValue(env[envKey], coerce), envKey, path, issues)
    else if (isPlainObject(node))
      out[key] = walk(node, env, coerce, envKey, path, issues)
    else
      throw new TypeError(`Invalid config shape at "${path}": expected a Standard Schema or a nested object.`)
  }

  return out
}

function assertNoEnvKeyCollisions(
  shape: ConfigShape,
  envPrefix: string,
  pathPrefix: string,
  seen: Map<string, string>,
): void {
  for (const [key, node] of Object.entries(shape)) {
    const envKey = envPrefix ? `${envPrefix}_${toEnvKey(key)}` : toEnvKey(key)
    const path = pathPrefix ? `${pathPrefix}.${key}` : key

    if (isStandardSchema(node)) {
      const existing = seen.get(envKey)
      if (existing !== undefined)
        throw new TypeError(`Config env-key collision: "${path}" and "${existing}" both map to "${envKey}". Rename one leaf.`)
      seen.set(envKey, path)
    }
    else if (isPlainObject(node)) {
      assertNoEnvKeyCollisions(node, envKey, path, seen)
    }
  }
}

/**
 * Wires a {@link ConfigShape} into the `validate` and `load` options of `@nestjs/config`,
 * mapping each leaf schema to an UPPER_SNAKE_CASE env key.
 *
 * @remarks
 * Each top-level key becomes a `registerAs` token (`CONFIGURATION(<key>)`); keep these unique
 * across every `defineConfig` in one app. Pair `load` with this instance's `validate` — a
 * standalone `load` factory re-parses `process.env` and misses `.env`/`expandVariables` values.
 *
 * @param shape - Nested map of Standard Schemas; one leaf per env var.
 * @param options - Coercion behavior; see {@link DefineConfigOptions}.
 * @returns The `validate` and `load` wiring for `ConfigModule.forRoot`.
 *
 * @throws A {@link ConfigValidationError} when one or more env values fail their schema.
 *
 * @throws A {@link TypeError} when two leaves map to the same env key, or a node is neither a Standard Schema nor a nested object.
 *
 * @example
 * ```ts
 * export const config = defineConfig({
 *   port: z.coerce.number().default(3000),
 *   database: { url: z.string().url() },
 * })
 *
 * ConfigModule.forRoot({ validate: config.validate, load: config.load })
 * ```
 */
export function defineConfig<T extends ConfigShape>(
  shape: T,
  options: DefineConfigOptions = {},
): DefineConfigResult<T> {
  assertNoEnvKeyCollisions(shape, '', '', new Map())
  const coerce = options.coerce ?? true
  let cache: InferConfig<T> | undefined

  const parse = (env: Record<string, unknown>): InferConfig<T> => {
    const issues: ConfigIssue[] = []
    const value = walk(shape, env, coerce, '', '', issues)
    if (issues.length > 0)
      throw new ConfigValidationError(issues)
    return value as InferConfig<T>
  }

  const validate = (env: Record<string, unknown>): InferConfig<T> => {
    cache = undefined
    const parsed = parse(env)
    cache = parsed
    return parsed
  }

  const getParsed = (): InferConfig<T> => (cache ??= parse(process.env))

  const load = Object.keys(shape).map(key =>
    registerAs(key, () => (getParsed() as Record<string, ConfigObject>)[key]),
  )

  return { validate, load, _env: null as never }
}
