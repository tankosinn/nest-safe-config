# nest-safe-config

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]

Validate NestJS config with [Standard Schema](https://standardschema.dev).

Define your environment as a schema and get validated, coerced, fully typed config for `@nestjs/config`. Works with [Zod](https://zod.dev), [Valibot](https://valibot.dev), [ArkType](https://arktype.io), or any Standard Schema validator.

## Features

- 🧩 **Validator-agnostic:** Use Zod, Valibot, ArkType, or any Standard Schema library.
- 🔒 **End-to-end types:** Infer a typed config for `ConfigService` and `process.env` from one schema.
- ♻️ **Automatic coercion:** Env strings become numbers, booleans, and JSON, with an opt-out.
- 🧱 **Structured config:** Nested schemas map to `UPPER_SNAKE_CASE` keys and namespaced config.
- 🚦 **Fail fast:** Invalid env aborts startup and reports every problem at once.

## Install

```sh
pnpm add nest-safe-config @nestjs/config zod # or valibot, arktype, ...
```

## Usage

### 1. Define your config

Each leaf schema maps to one environment variable. Nested objects become key prefixes.

```ts
// app.config.ts
import { defineConfig } from 'nest-safe-config'
import { z } from 'zod'

export const config = defineConfig({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.number().default(3000),
  database: {
    url: z.string(),
    poolSize: z.number().default(10),
  },
})
```

<details>
<summary>Valibot</summary>

```ts
import { defineConfig } from 'nest-safe-config'
import * as v from 'valibot'

export const config = defineConfig({
  nodeEnv: v.optional(v.picklist(['development', 'production', 'test']), 'development'),
  port: v.optional(v.number(), 3000),
  database: {
    url: v.string(),
    poolSize: v.optional(v.number(), 10),
  },
})
```

</details>

<details>
<summary>ArkType</summary>

```ts
import { type } from 'arktype'
import { defineConfig } from 'nest-safe-config'

export const config = defineConfig({
  nodeEnv: type('"development" | "production" | "test"'),
  port: type('number'),
  database: {
    url: type('string'),
    poolSize: type('number'),
  },
})

export type AppConfig = InferConfig<typeof config>
```

> ArkType `.default()` is not supported on a standalone leaf. See [Known limitations](#known-limitations).

</details>

### 2. Register the module

Pass `validate` and `load` to `ConfigModule.forRoot`. `validate` runs at startup; `load` exposes one namespaced config per top-level key.

```ts
// app.module.ts
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { config } from './app.config'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: config.validate,
      load: config.load,
    }),
  ],
})
export class AppModule {}
```

NestJS loads `.env` and merges it over `process.env` before `validate` runs, so these rules apply to `.env` values too. Use `validate` and `load` from the same `defineConfig` result.

### 3. Read config in a service

Type `ConfigService` with `InferConfig` for autocompletion and inferred return types on `get`.

```ts
// app.service.ts
import type { InferConfig } from 'nest-safe-config'
import type { AppConfig, config } from './app.config'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class AppService {
  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  get port(): number {
    return this.configService.get('port', { infer: true })
  }

  get databaseUrl(): string {
    return this.configService.get('database.url', { infer: true })
  }
}
```

### 4. Type `process.env` (optional)

Augment `NodeJS.ProcessEnv` with `InferProcessEnv` so direct `process.env` reads are typed. This is useful outside the DI container, for example in `main.ts` or instrumentation files.

```ts
// env.d.ts
import type { InferProcessEnv } from 'nest-safe-config'
import type { config } from './app.config'

declare global {
  namespace NodeJS {
    interface ProcessEnv extends InferProcessEnv<typeof config> {}
  }
}

export {}
```

## Recipes

### Nested configuration

Nested keys are joined into a single `UPPER_SNAKE_CASE` variable.

```ts
defineConfig({
  mail: {
    auth: { user: z.string(), pass: z.string() },
  },
})
// reads MAIL_AUTH_USER and MAIL_AUTH_PASS
```

Read a whole namespace with a dotted path: `configService.get('mail.auth', { infer: true })`.

### Objects, arrays, and JSON

A leaf whose schema is an object, array, or record is parsed from a single JSON-encoded variable. A union leaf accepts whichever branch matches: a JSON value for an object or array branch, or a plain string for a string branch.

```ts
defineConfig({
  // ORIGINS='["https://a.com","https://b.com"]'
  origins: z.array(z.string()),

  // a path to a file, or the inline JSON itself
  googleApplicationCredentials: z.union([
    z.string(),
    z.object({
      project_id: z.string(),
      client_email: z.string(),
      private_key: z.string(),
    }),
  ]).optional(),
})
```

```sh
GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp.json
# or
GOOGLE_APPLICATION_CREDENTIALS='{"project_id":"app","client_email":"sa@app.iam","private_key":"..."}'
```

### Coercion

Env strings are pre-parsed with [`destr`](https://github.com/unjs/destr) by default, so `number`, `boolean`, and JSON schemas work without `z.coerce`.

```ts
defineConfig({ port: z.number(), debug: z.boolean() })
// PORT=3000  becomes the number 3000
// DEBUG=true becomes the boolean true
```

> `destr` is lenient. It normalizes some inputs (for example `'8e3'` becomes `8000`) and strips surrounding quotes, while out-of-range or leading-zero digit strings stay strings. Use `{ coerce: false }` to keep a value exactly as written.

### Disabling coercion

Set `{ coerce: false }` to keep env strings raw, for values that must not be parsed such as secrets that look numeric.

```ts
defineConfig({ apiKey: z.string() }, { coerce: false })
```

With coercion off, opt individual leaves back into parsing through your validator, for example `z.coerce.number()`.

### Defaults and optionals

Missing, empty, and whitespace-only values are treated as absent, so defaults and optionals apply.

```ts
defineConfig({
  port: z.number().default(3000), // PORT unset or blank -> 3000
  sentryDsn: z.string().optional(), // SENTRY_DSN unset -> undefined
})
```

### Validation and transforms

Lean on your validator: built-in formats and constraints, custom refinements, and transforms.

```ts
import { defineConfig } from 'nest-safe-config'
import { z } from 'zod'

export const config = defineConfig({
  // built-in formats and constraints
  port: z.int().min(1).max(65535),
  publicUrl: z.url(),

  // custom refinement
  stripeKey: z.string().refine(v => v.startsWith('sk_'), 'must start with "sk_"'),

  // transform: "a.com, b.com" -> ["a.com", "b.com"]
  corsOrigins: z.string().transform(v => v.split(',').map(o => o.trim())),
})
```

Transformed output types flow through: `InferConfig` and `ConfigService` see `corsOrigins` as `string[]`. Validation is synchronous, so async refinements and transforms throw at startup; move that work into your bootstrap.

### Error reporting

When validation fails, startup aborts with a `ConfigValidationError` that lists every offending variable.

```text
Config validation failed:
  - port: Invalid input: expected number, received string (env: PORT)
  - database.url: Invalid input: expected string, received undefined (env: DATABASE_URL)
```

The error exposes a structured `issues` array (`path`, `env`, `message`, `raw`) and sets `cause` to the underlying Standard Schema issues.

## Environment variable mapping

Keys are converted to `UPPER_SNAKE_CASE`. Nested objects are joined with underscores.

| Schema path          | Environment variable      |
| -------------------- | ------------------------- |
| `port`               | `PORT`                    |
| `apiKey`             | `API_KEY`                 |
| `database.url`       | `DATABASE_URL`            |
| `database.poolSize`  | `DATABASE_POOL_SIZE`      |
| `mail.auth.user`     | `MAIL_AUTH_USER`          |

## Known limitations

- **Synchronous only.** Async refinements and transforms (Zod async `.refine`, Valibot `*Async`, ArkType async morphs) throw at validation time.
- **ArkType defaults.** A standalone leaf cannot use `.default()`, because the result is not a Standard Schema. Wrap it in an object schema, or apply the default in your own bootstrap.

## License

[MIT](./LICENSE) License © [Tankosin](https://github.com/tankosinn)

<!-- Badges -->

[npm-version-src]: https://npmx.dev/api/registry/badge/version/nest-safe-config
[npm-version-href]: https://npmx.dev/package/nest-safe-config
[npm-downloads-src]: https://npmx.dev/api/registry/badge/downloads/nest-safe-config
[npm-downloads-href]: https://npmx.dev/package/nest-safe-config
[license-src]: https://img.shields.io/npm/l/nest-safe-config?style=flat&colorA=080f12&colorB=1fa669
[license-href]: ./LICENSE
