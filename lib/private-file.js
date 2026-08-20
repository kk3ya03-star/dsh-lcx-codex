import { execFileSync } from 'node:child_process'

export function ensurePrivateFileAcl(target) {
  if (process.platform !== 'win32') return true
  try {
    const identity = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    }).match(/S-1-[0-9-]+/iu)?.[0]
    if (!identity) return false
    const sids = [identity, 'S-1-5-18', 'S-1-5-32-544'].map((sid) => `*${sid}:F`)
    execFileSync('icacls.exe', [target, '/inheritance:r', '/grant:r', ...sids], {
      encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}
