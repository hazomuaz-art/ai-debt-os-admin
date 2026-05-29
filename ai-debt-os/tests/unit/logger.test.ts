import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createLogger, captureError, logRequest } from '@/lib/logger'

describe('createLogger', () => {
  let consoleSpy: { log: any; error: any; warn: any }

  beforeEach(() => {
    consoleSpy = {
      log:   vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn:  vi.spyOn(console, 'warn').mockImplementation(() => {}),
    }
  })

  it('creates a logger with module prefix', () => {
    const log = createLogger('test-module')
    log.info('test message')
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining('test-module')
    )
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining('test message')
    )
  })

  it('logs errors to console.error', () => {
    const log = createLogger('test')
    log.error('something failed', new Error('test error'))
    expect(consoleSpy.error).toHaveBeenCalled()
  })

  it('logs warnings to console.warn', () => {
    const log = createLogger('test')
    log.warn('warning message')
    expect(consoleSpy.warn).toHaveBeenCalled()
  })

  it('includes context in log output', () => {
    const log = createLogger('test')
    log.info('with context', { user_id: 'abc', action: 'score' })
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining('abc')
    )
  })

  it('time() returns the function result', async () => {
    const log = createLogger('test')
    const result = await log.time('operation', async () => 42)
    expect(result).toBe(42)
  })

  it('time() re-throws errors', async () => {
    const log = createLogger('test')
    await expect(
      log.time('failing-op', async () => { throw new Error('fail') })
    ).rejects.toThrow('fail')
  })
})

describe('captureError', () => {
  it('returns a MonitoredError object', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = captureError(new Error('test error'), 'database_error', { debt_id: 'abc' })
    expect(result.category).toBe('database_error')
    expect(result.message).toBe('test error')
    expect(result.timestamp).toBeTruthy()
  })

  it('handles non-Error objects', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = captureError('string error', 'unexpected_error')
    expect(result.message).toBe('string error')
  })
})

describe('logRequest', () => {
  it('logs to console.log for 2xx', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logRequest('GET', '/api/debts', 200, 45)
    expect(spy).toHaveBeenCalled()
  })

  it('logs to console.warn for 4xx', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logRequest('POST', '/api/debts', 422, 12)
    expect(spy).toHaveBeenCalled()
  })

  it('logs to console.error for 5xx', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logRequest('POST', '/api/ai/score', 500, 3000)
    expect(spy).toHaveBeenCalled()
  })
})
