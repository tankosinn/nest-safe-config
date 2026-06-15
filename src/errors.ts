import type { StandardSchemaV1 } from '@standard-schema/spec'

/** A single normalized validation failure. */
export interface ConfigIssue {
  /** Dotted config path, e.g. `mail.auth.user`. */
  readonly path: string
  /** The environment variable backing the failing leaf, e.g. `MAIL_AUTH_USER`. */
  readonly env: string
  /** The validation library's message. */
  readonly message: string
  /** The original Standard Schema issue; carries the validator's native fields at runtime. */
  readonly raw: StandardSchemaV1.Issue
}

function format(issues: readonly ConfigIssue[]): string {
  if (issues.length === 0)
    return 'Config validation failed.'
  const lines = issues.map(({ path, env, message }) => `  - ${path}: ${message} (env: ${env})`)
  return `Config validation failed:\n${lines.join('\n')}`
}

/** Thrown by the `validate` function when one or more env values fail their schema. */
export class ConfigValidationError extends Error {
  override readonly name = 'ConfigValidationError'

  constructor(readonly issues: readonly ConfigIssue[]) {
    super(format(issues), { cause: issues.map(issue => issue.raw) })
  }
}
