// Path equality for the main process. Windows can spell one folder two ways (an 8.3 short name such as
// C:\Users\RUNNER~1\... versus the long name git prints), so existing paths are compared by their real long form.
import { realpathSync } from 'node:fs'
import { samePath } from '../shared/devCore'

const real = (p: string): string => { try { return realpathSync.native(p) } catch { return p } }

export const sameDir = (a: string, b: string): boolean => samePath(a, b) || samePath(real(a), real(b))
