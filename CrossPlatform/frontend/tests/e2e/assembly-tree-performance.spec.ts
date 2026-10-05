import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Supply the real assembly for the performance reproduction; the proprietary file is not a fixture
// in this repository. ELECTRON_RENDERER_URL can point at npm run dev's Vite server for the same test
// against the development renderer.
const assemblyPath = process.env.DNSPY_E2E_PERF_ASSEMBLY
const namespaceName = process.env.DNSPY_E2E_PERF_NAMESPACE ?? 'Fiddler.WebUi.Constants'

test('expands a namespace while an assembly document is decompiling', async ({}, testInfo) => {
  test.skip(!assemblyPath, 'Set DNSPY_E2E_PERF_ASSEMBLY to the assembly used to reproduce the slow expansion.')
  const userData = mkdtempSync(path.join(os.tmpdir(), 'dnspy-restore-'))
  const app = await electron.launch({
    args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`, '--open', assemblyPath!],
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: process.env,
  })
  try {
    const page = await app.firstWindow()
    await page.locator('.tree-row[data-kind="assembly"]').waitFor()
    const root = page.locator('.tree-row[data-kind="assembly"]')
    await root.locator('.tree-expander').click({ force: true })
    const module = page.locator('.tree-row[data-kind="module"]')
    await module.waitFor()
    await module.locator('.tree-expander').click({ force: true })
    const constants = page.locator('.tree-row[data-kind="namespace"]').filter({ has: page.getByText(namespaceName, { exact: true }) })
    await constants.waitFor()
    await root.dblclick({ force: true })
    await page.waitForTimeout(500)
    // The dev renderer exposes its store through Vite's module graph. Verify that the document is
    // actually pending, so a failed/finished decompilation cannot make this timing test pass.
    const isDocumentLoading = async (): Promise<boolean> => page.evaluate(async () => {
      const storeModule = '/src/app-store.ts'
      const { useAppStore } = await import(/* @vite-ignore */ storeModule)
      return Object.values(useAppStore.getState().documents).some((document) => (document as { loading: boolean }).loading)
    })
    if (process.env.ELECTRON_RENDERER_URL)
      expect(await isDocumentLoading()).toBe(true)
    const start = Date.now()
    await constants.locator('.tree-expander').click({ force: true })
    await expect(page.locator('.tree-row[data-kind="type"]').first()).toBeVisible({ timeout: 3_000 })
    const elapsedMs = Date.now() - start
    // This workload takes many seconds to decompile. The tree must finish first, without a timeout or
    // cancelling the document request to unblock it.
    await expect(page.locator('.monaco-editor')).toHaveCount(0)
    if (process.env.ELECTRON_RENDERER_URL)
      expect(await isDocumentLoading()).toBe(true)
    console.log(`${namespaceName} expansion during assembly decompilation: ${elapsedMs}ms`)
    await testInfo.attach('expansion-timing', { body: JSON.stringify({ namespaceName, elapsedMs, renderer: process.env.ELECTRON_RENDERER_URL ?? 'built' }), contentType: 'application/json' })
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
