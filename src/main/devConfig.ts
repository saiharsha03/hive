// Orbit's own .env (git ignores it) under the settings store: the workspace-specific settings for Pull latest,
// Dev stack, Deploy, the Dependabot watcher, Watch, the file-drop skills and the app name.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDevConfig, parseEnvFile, type DevConfig } from '../shared/devCore'

// env = every KEY=VALUE in effect (the store over the .env), for the features that parse their own keys
export type Loaded = { config: DevConfig | null; message: string; path: string; env: Record<string, string> }

// the .env sits in the Orbit folder (HIVE_ENV_FILE overrides, for tests); missing or unreadable = no keys
export function readDotEnv(appDir: string): { path: string; env: Record<string, string>; error: string } {
  const path = process.env.HIVE_ENV_FILE || join(appDir, '.env')
  if (!existsSync(path)) return { path, env: {}, error: '' }
  try {
    return { path, env: parseEnvFile(readFileSync(path, 'utf8')), error: '' }
  } catch (e) {
    return { path, env: {}, error: `Could not read ${path}: ${(e as Error).message}` }
  }
}

// overlay = the settings store applied over the .env keys
export function loadConfig(appDir: string, overlay: (env: Record<string, string>) => Record<string, string> = (e) => e): Loaded {
  const dot = readDotEnv(appDir)
  const env = overlay(dot.env)
  const parsed = parseDevConfig(env)
  const where = 'Orbit settings'
  if (!parsed.config) {
    const why = dot.error || (!existsSync(dot.path) && !Object.keys(env).length ? `No settings yet and no .env at ${dot.path}` : parsed.problems.join('; '))
    return { config: null, path: dot.path, env, message: `${why}. Set the repos root in Settings.` }
  }
  const message = parsed.problems.length ? `Config problems in ${where}: ${parsed.problems.join('; ')}` : ''
  return { config: parsed.config, path: dot.path, env, message }
}
