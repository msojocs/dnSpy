import { existsSync } from 'node:fs'
import type { ChildProcess } from 'node:child_process'

/** How often the marker file and the child are looked at while waiting. */
const pollIntervalMs = 200

/**
 * Waits for the elevated copy to announce itself by writing `marker`.
 *
 * pkexec's own exit status is no use here: it returns only once the command it started has exited, so
 * a still-running child says nothing about whether the copy ever came up, and with no authentication
 * agent reachable it waits forever instead of failing. The marker is the one trustworthy sign, and a
 * wait that never sees it ends in `timeoutMessage`.
 *
 * Resolves undefined once the marker is there, or the message to show the user when pkexec gave up
 * (`failureMessage`) or nothing happened for `timeoutMs` (`timeoutMessage`). Either way the caller
 * still owns the child and has to deal with it.
 */
export const waitForElevatedStart = (
  child: ChildProcess,
  marker: string,
  timeoutMs: number,
  failureMessage: string,
  timeoutMessage: string,
): Promise<string | undefined> => new Promise((resolve) => {
  const deadline = Date.now() + timeoutMs
  const timer = setInterval(() => {
    if (existsSync(marker)) {
      clearInterval(timer)
      resolve(undefined)
    }
    else if (child.exitCode !== null || child.signalCode !== null) {
      clearInterval(timer)
      resolve(failureMessage)
    }
    else if (Date.now() >= deadline) {
      clearInterval(timer)
      resolve(timeoutMessage)
    }
  }, pollIntervalMs)
})
