import type { ConfigFactory, ConfigFactoryKeyHost, ConfigObject } from '@nestjs/config'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { SnakeCase } from 'scule'

type Prettify<T> = { [K in keyof T]: T[K] } & {}

type UnionToIntersection<U>
  = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never

// scule's `SnakeCase` type can diverge from the runtime `snakeCase` for a single leading
// lowercase letter followed by 2+ capitals (e.g. `aBC`)
type UpperSnakeCase<S extends string> = Uppercase<SnakeCase<S>>

/** A nested map of schemas; each leaf maps to one env var, nested objects to env-key prefixes. */
export interface ConfigShape {
  [key: string]: StandardSchemaV1 | ConfigShape
}

/**
 * Resolves the validated, coerced config object inferred from a {@link ConfigShape}
 * or a `defineConfig` result.
 */
export type InferConfig<T>
  = T extends DefineConfigResult<infer S>
    ? InferConfig<S>
    : T extends StandardSchemaV1
      ? StandardSchemaV1.InferOutput<T>
      : T extends ConfigShape
        ? Prettify<{ [K in keyof T]: InferConfig<T[K]> }>
        : never

type EnvValue<S extends StandardSchemaV1>
  = undefined extends StandardSchemaV1.InferInput<S> ? string | undefined : string

type FlattenEnvKeys<T, Prefix extends string = ''>
  = T extends StandardSchemaV1
    ? { [K in Prefix]: EnvValue<T> }
    : T extends ConfigShape
      ? [keyof T] extends [never]
          ? Record<never, string>
          : UnionToIntersection<{
            [K in keyof T]: FlattenEnvKeys<
              T[K],
              Prefix extends '' ? UpperSnakeCase<`${K & (string | number)}`> : `${Prefix}_${UpperSnakeCase<`${K & (string | number)}`>}`
            >
          }[keyof T]>
      : never

/**
 * Resolves the flattened `process.env` keys (UPPER_SNAKE_CASE) inferred from a
 * `defineConfig` result, for augmenting `NodeJS.ProcessEnv`.
 */
export type InferProcessEnv<T extends DefineConfigResult<any>> = Prettify<T['_env']>

/** Options for `defineConfig`. */
export interface DefineConfigOptions {
  /**
   * Pre-parse env strings with `destr` so `number`/`boolean`/JSON schemas coerce without extra config.
   *
   * @remarks
   * `destr` is lenient: `'8e3'` → `8000`, long digit strings lose precision, surrounding quotes are
   * stripped, and malformed JSON stays a raw string. Set `false` to keep raw strings.
   *
   * @defaultValue `true`
   */
  readonly coerce?: boolean
}

/** The wired result returned by `defineConfig`. */
export interface DefineConfigResult<T extends ConfigShape> {
  /** Pass to `ConfigModule.forRoot({ validate })`. */
  readonly validate: (env: Record<string, unknown>) => InferConfig<T>

  /** Pass to `ConfigModule.forRoot({ load })`; one namespaced factory per top-level key. */
  readonly load: Array<ConfigFactory<ConfigObject> & ConfigFactoryKeyHost<ConfigObject>>

  /**
   * Type-only carrier of the inferred env keys; consumed by {@link InferProcessEnv}.
   *
   * @internal
   */
  readonly _env: FlattenEnvKeys<T>
}
