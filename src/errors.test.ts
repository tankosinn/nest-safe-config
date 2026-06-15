import type { ConfigIssue } from './errors'
import { describe, expect, it } from 'vitest'
import { ConfigValidationError } from './errors'

function issue(over: Partial<ConfigIssue> = {}): ConfigIssue {
  return {
    path: 'database.url',
    env: 'DATABASE_URL',
    message: 'Required',
    raw: { message: 'Required' },
    ...over,
  }
}

describe('ConfigValidationError', () => {
  describe('construction', () => {
    it('is an instance of Error', () => {
      expect(new ConfigValidationError([issue()])).toBeInstanceOf(Error)
    })

    it('is an instance of ConfigValidationError', () => {
      expect(new ConfigValidationError([issue()])).toBeInstanceOf(ConfigValidationError)
    })

    it('sets name to "ConfigValidationError"', () => {
      expect(new ConfigValidationError([issue()]).name).toBe('ConfigValidationError')
    })

    it('exposes the issues it was constructed with', () => {
      const issues = [issue(), issue({ path: 'port', env: 'PORT' })]

      expect(new ConfigValidationError(issues).issues).toBe(issues)
    })

    it('exposes the raw issues as the error cause', () => {
      const issues = [issue(), issue({ path: 'port', env: 'PORT' })]

      expect(new ConfigValidationError(issues).cause).toEqual(issues.map(i => i.raw))
    })
  })

  describe('message formatting', () => {
    it('formats a single issue as "  - path: message (env: ENV)"', () => {
      const error = new ConfigValidationError([
        issue({ path: 'port', env: 'PORT', message: 'Expected number' }),
      ])

      expect(error.message).toBe('Config validation failed:\n  - port: Expected number (env: PORT)')
    })

    it('formats multiple issues as one line each', () => {
      const error = new ConfigValidationError([
        issue({ path: 'port', env: 'PORT', message: 'Expected number' }),
        issue({ path: 'database.url', env: 'DATABASE_URL', message: 'Required' }),
      ])

      expect(error.message).toBe([
        'Config validation failed:',
        '  - port: Expected number (env: PORT)',
        '  - database.url: Required (env: DATABASE_URL)',
      ].join('\n'))
    })

    it('formats an empty issue list as a single clean line', () => {
      expect(new ConfigValidationError([]).message).toBe('Config validation failed.')
    })
  })
})
