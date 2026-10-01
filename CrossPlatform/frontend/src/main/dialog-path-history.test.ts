import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DialogPathHistory } from './dialog-path-history'

const temporaryRoots: string[] = []

const createTemporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dnspy-dialog-history-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('DialogPathHistory', () => {
  it('persists and reloads the directory of the selected file', async () => {
    const root = await createTemporaryRoot()
    const openDirectory = path.join(root, 'assemblies')
    const settingsPath = path.join(root, 'settings', 'dialog-state.json')
    await mkdir(openDirectory)

    const history = new DialogPathHistory(settingsPath)
    await history.rememberOpenedFile(path.join(openDirectory, 'Example.dll'))

    expect(history.openDirectory).toBe(openDirectory)
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ lastOpenDirectory: openDirectory })

    const restored = new DialogPathHistory(settingsPath)
    await restored.load()
    expect(restored.openDirectory).toBe(openDirectory)
  })

  it('ignores a remembered directory that no longer exists', async () => {
    const root = await createTemporaryRoot()
    const settingsPath = path.join(root, 'dialog-state.json')
    await writeFile(settingsPath, JSON.stringify({ lastOpenDirectory: path.join(root, 'missing') }))

    const history = new DialogPathHistory(settingsPath)
    await history.load()

    expect(history.openDirectory).toBeUndefined()
  })

  it('ignores malformed settings without failing startup', async () => {
    const root = await createTemporaryRoot()
    const settingsPath = path.join(root, 'dialog-state.json')
    await writeFile(settingsPath, '{not-json')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const history = new DialogPathHistory(settingsPath)
    await history.load()

    expect(history.openDirectory).toBeUndefined()
    expect(console.warn).toHaveBeenCalledOnce()
  })
})
