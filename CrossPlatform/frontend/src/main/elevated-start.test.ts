import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { waitForElevatedStart } from './elevated-start'

describe('waitForElevatedStart', () => {
  let directory: string
  let marker: string

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'dnspy-elevated-'))
    marker = path.join(directory, 'ready')
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  // A stand-in for the pkexec child: something that stays alive until it is killed.
  const liveChild = () => spawn('sleep', ['30'], { stdio: 'ignore' })

  it('resolves without a message once the elevated copy writes its marker', async () => {
    const child = liveChild()
    writeFileSync(marker, '1234')
    await expect(waitForElevatedStart(child, marker, 5_000, 'failed', 'timed out')).resolves.toBeUndefined()
    child.kill()
  })

  it('reports the failure message when the child gives up first', async () => {
    // pkexec exiting is the one case its exit status does mean something: it never started the copy.
    const child = spawn('false', [], { stdio: 'ignore' })
    await expect(waitForElevatedStart(child, marker, 5_000, 'failed', 'timed out')).resolves.toBe('failed')
  })

  it('reports the timeout message when nothing ever happens', async () => {
    // The state this guards against is pkexec waiting on an authentication agent that is not there,
    // which looks exactly like this: a live child, and no marker, for as long as anyone waits.
    const child = liveChild()
    await expect(waitForElevatedStart(child, marker, 300, 'failed', 'timed out')).resolves.toBe('timed out')
    child.kill()
  })
})
