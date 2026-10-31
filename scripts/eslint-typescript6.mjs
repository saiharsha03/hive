// typescript-eslint parses with the TypeScript compiler API, which the native TypeScript 7 compiler does not
// ship. The project type-checks with TypeScript 7 (`npm run typecheck`); inside the ESLint process only, every
// `typescript` import is pointed at the TypeScript 6 package installed as `typescript-for-lint`.
// Remove this file (and that dev dependency) once typescript-eslint supports TypeScript 7.
import { registerHooks } from 'node:module'

registerHooks({
  resolve: (specifier, context, next) => next(specifier === 'typescript' ? 'typescript-for-lint' : specifier, context),
})
