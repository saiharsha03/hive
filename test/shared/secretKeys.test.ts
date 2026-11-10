// Which setting names are credentials (they stay in the .env and never enter hive-settings.json or the Settings page).
import { describe, expect, it } from 'vitest'
import { emptyGeneral, envForSave, isSecretKey, normalizeSettings, seedSettings, validateSettings } from '../../src/shared/settingsCore'

describe('isSecretKey', () => {
  it('knows the common credential names', () => {
    for (const k of [
      'HIVE_TRACKER_TOKEN', 'GH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'CLIENT_SECRET', 'DB_PASSWORD', 'PGPASSWORD', 'SOME_API_KEY', 'OPENAI_APIKEY', 'PRIVATE_KEY',
      // these all used to pass as plain settings
      'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL', 'REDIS_URL', 'MONGODB_URI', 'DB_PASS', 'SMTP_PASS', 'SF_PWD', 'GITHUB_PAT', 'SSH_KEY',
      'ENCRYPTION_KEY', 'HIVE_RELAY_KEY', 'SLACK_WEBHOOK_URL', 'TEAMS_WEBHOOK', 'SENTRY_DSN', 'JIRA_AUTH', 'BASIC_AUTH', 'SESSION_COOKIE', 'COOKIE',
    ]) expect(isSecretKey(k), k).toBe(true)
  })

  it('leaves limits, places and ordinary settings alone', () => {
    for (const k of [
      'HIVE_REPOS_ROOT', 'HIVE_DEPLOY_SCRIPT', 'HIVE_WORKTREES_DIR', 'HIVE_HANDOFF_AT', 'HIVE_WATCHER_POST_SHA256', 'HIVE_MOBILE_RELAY',
      // a token count is a limit, not a token
      'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'MAX_THINKING_TOKENS', 'MAX_TOKENS',
      // a file, path or folder names a place
      'HIVE_TRACKER_TOKEN_FILE', 'KEY_PATH', 'SECRET_KEY_PATH', 'CREDENTIALS_DIR',
      // a service or suite may be called auth, key, pass or webhook: only the last word counts for those
      'HIVE_SVC_AUTH_REPO', 'HIVE_SVC_AUTH_CMD', 'HIVE_SVC_KEY_PORT', 'HIVE_SVC_PASS_NAME', 'HIVE_SVC_WEBHOOK_CMD', 'HIVE_DEPLOY_SUITE_AUTH_API', 'HIVE_SVC_API_ENV',
      'API_URL', 'KEYBOARD', 'PATH', 'COMPASS',
    ]) expect(isSecretKey(k), k).toBe(false)
  })

  it('keeps them out of the store on seed, load and save', () => {
    const dot = { HIVE_REPOS_ROOT: 'C:/r', AWS_ACCESS_KEY_ID: 'AKIA', DATABASE_URL: 'postgres://u:p@h/db', DB_PASS: 'p', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000' }
    expect(seedSettings(dot, null).env).toEqual({ HIVE_REPOS_ROOT: 'C:/r', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000' })
    expect(normalizeSettings({ env: dot })!.env).toEqual({ HIVE_REPOS_ROOT: 'C:/r', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000' })
    expect(envForSave({ HIVE_REPOS_ROOT: 'D:/r', SMTP_PASS: 'x', MAX_TOKENS: '9' }, dot)).toEqual({ HIVE_REPOS_ROOT: 'D:/r', MAX_TOKENS: '9', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '' })
  })

  it('a draft that holds one is refused', () => {
    const problems = validateSettings({ env: { SENTRY_DSN: 'https://k@sentry.example/1' }, scripts: null, general: emptyGeneral() }, () => true)
    expect(problems).toEqual([expect.objectContaining({ key: 'SENTRY_DSN', level: 'error' })])
  })
})

describe('the app name', () => {
  const check = (appName: string) => validateSettings({ env: {}, scripts: null, general: { ...emptyGeneral(), appName } }, () => true).filter((p) => p.key === 'general.appName')
  it('cannot hold brackets or a line break (it sits inside one-line [..] headers)', () => {
    expect(check('Hive')).toEqual([])
    expect(check('Hive (work)')).toEqual([])
    for (const bad of ['Hive [work]', 'Hive]', '[Hive', 'Hive\nwork']) expect(check(bad).map((p) => p.level), bad).toEqual(['error'])
  })
})
