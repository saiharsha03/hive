// Minimal stand-in for the electron module so main-process code can be imported under Vitest.
import { tmpdir } from 'node:os'

const noop = () => {}
export const app = { getPath: () => tmpdir(), getAppPath: () => '.', isPackaged: false, on: noop, whenReady: () => Promise.resolve() }
export const BrowserWindow = { getAllWindows: () => [] }
export const shell = { openExternal: noop, openPath: async () => '' }
export const ipcMain = { handle: noop, on: noop }
export const clipboard = { readText: () => '', writeText: noop }
export const nativeImage = {}
export const dialog = {}
export const Menu = {}
export const Notification = class { show() {} }
export const powerMonitor = { on: noop }
export const protocol = { registerSchemesAsPrivileged: noop, handle: noop }
export const net = {}
export default { app, BrowserWindow, shell, ipcMain, clipboard, nativeImage, dialog, Menu, Notification, powerMonitor, protocol, net }
