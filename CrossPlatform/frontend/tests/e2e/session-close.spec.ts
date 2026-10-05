import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const assemblyPath = path.resolve(import.meta.dirname, '../../../backend/dnSpy.Backend.Contracts/bin/Debug/net10.0/dnSpy.Backend.Contracts.dll')
const frontend = path.resolve(import.meta.dirname, '../..')

const storedSession = async (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('dnspy.session.v1') ?? 'null') as {
  paths: string[]
  nodes: unknown[]
  documents: unknown[]
} | null)

// Keep a restoration's decompilation pending without relying on a proprietary assembly being slow.
// The tree and workspace still use the real backend, and Close All and window exit are UI clicks.
interface PendingRestore {
  started: boolean
  finish?: () => void
}

test('Close All during restoration survives an immediate window exit and restart', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(path.join(os.tmpdir(), 'dnspy-close-session-'))
  let app: ElectronApplication | undefined
  const launch = async () => {
    app = await electron.launch({
      args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
      cwd: frontend,
      env: { ...process.env, DNSPY_E2E_ASSEMBLY: assemblyPath },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    return page
  }
  try {
    let page = await launch()
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Open Assembly' }).first().click()
    const root = page.locator('.tree-row[data-kind="assembly"]')
    await expect(root).toBeVisible()
    const title = await root.locator('.tree-label').innerText()
    await root.dblclick()
    await expect(page.getByRole('tab', { name: title, exact: true })).toBeVisible()
    await expect.poll(async () => (await storedSession(page))?.documents.length).toBe(1)

    await app!.evaluate(({ ipcMain }) => {
      const gate: PendingRestore = { started: false }
      ;(globalThis as typeof globalThis & { pendingRestore: PendingRestore }).pendingRestore = gate
      ipcMain.removeHandler('document:decompile')
      ipcMain.handle('document:decompile', async () => {
        gate.started = true
        await new Promise<void>((resolve) => { gate.finish = resolve })
        return { title: 'dnSpy.Backend.Contracts.HelloRequest', language: 'csharp', text: 'class HelloRequest {}', spans: [], diagnostics: [] }
      })
    })
    await page.reload()
    await expect.poll(() => app!.evaluate(() => (globalThis as typeof globalThis & { pendingRestore: PendingRestore }).pendingRestore.started)).toBe(true)

    await page.getByRole('menuitem', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Close All', exact: true }).click()
    await expect(page.getByText('No assemblies loaded', { exact: true })).toBeVisible()
    expect(await storedSession(page)).toMatchObject({ paths: [], nodes: [], documents: [] })

    await testInfo.attach('cleared-during-restore', { body: await page.screenshot(), contentType: 'image/png' })
    const exited = app!.waitForEvent('close')
    await page.getByRole('button', { name: 'Close window', exact: true }).click()
    await exited

    page = await launch()
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await expect(page.getByText('No assemblies loaded', { exact: true })).toBeVisible()
    expect(await storedSession(page)).toMatchObject({ paths: [], nodes: [], documents: [] })
    await expect(page.locator('.tree-row')).toHaveCount(0)
    await testInfo.attach('empty-after-restart', { body: await page.screenshot(), contentType: 'image/png' })
  } finally {
    await app?.close().catch(() => undefined)
    rmSync(userData, { recursive: true, force: true })
  }
})

test('a late restoration response cannot reopen tabs after Close All', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(path.join(os.tmpdir(), 'dnspy-cancel-restore-'))
  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    cwd: frontend,
    env: { ...process.env, DNSPY_E2E_ASSEMBLY: assemblyPath },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Open Assembly' }).first().click()
    const root = page.locator('.tree-row[data-kind="assembly"]')
    await expect(root).toBeVisible()
    const title = await root.locator('.tree-label').innerText()
    await root.dblclick()
    await expect(page.getByRole('tab', { name: title, exact: true })).toBeVisible()
    await expect.poll(async () => (await storedSession(page))?.documents.length).toBe(1)

    await app.evaluate(({ ipcMain }) => {
      const gate: PendingRestore = { started: false }
      ;(globalThis as typeof globalThis & { pendingRestore: PendingRestore }).pendingRestore = gate
      ipcMain.removeHandler('document:decompile')
      ipcMain.handle('document:decompile', async () => {
        gate.started = true
        await new Promise<void>((resolve) => { gate.finish = resolve })
        return { title: 'dnSpy.Backend.Contracts.HelloRequest', language: 'csharp', text: 'class HelloRequest {}', spans: [], diagnostics: [] }
      })
    })
    await page.reload()
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { pendingRestore: PendingRestore }).pendingRestore.started)).toBe(true)
    await page.getByRole('menuitem', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Close All', exact: true }).click()
    await expect(page.getByText('No assemblies loaded', { exact: true })).toBeVisible()
    // A new Open must stay usable while the old restore's response is still pending.
    await page.getByRole('button', { name: 'Open Assembly' }).first().click()
    await expect(page.locator('.tree-row').first()).toContainText('dnSpy.Backend.Contracts')
    await app.evaluate(() => (globalThis as typeof globalThis & { pendingRestore: PendingRestore }).pendingRestore.finish?.())
    // Drain the renderer task queue after delivery so checking the missing tab cannot pass too early.
    await page.evaluate(() => new Promise<void>((resolve) => { setTimeout(resolve, 100) }))
    await expect(page.getByRole('tab', { name: title, exact: true })).toHaveCount(0)
    expect((await storedSession(page))?.paths).toEqual([assemblyPath])
    expect((await storedSession(page))?.documents).toEqual([])
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
