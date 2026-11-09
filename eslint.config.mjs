import './scripts/eslint-typescript6.mjs' // must come first: see the file
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'build/', 'node_modules/', 'test-results/', 'playwright-report/', 'e2e-report/', 'e2e-results/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      // unused args/vars are allowed when prefixed with _ ; caught errors are often deliberately ignored
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // a `let` that closures read before its single assignment (chat.ts builds a session that refers to itself)
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // SDK messages, IPC payloads and transcript lines are untyped JSON; they are narrowed where they are used
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // the React Compiler rules in react-hooks v7 (purity, refs, set-state-in-effect, memoization) only matter
      // when the compiler is on; Hive does not use it
    },
  },
  {
    files: ['test/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      // tests feed partial shapes and raw SDK events into the reducers
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
