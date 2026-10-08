import { test, expect, chromium, type Browser } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { access } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const executable = process.env.DNSPY_PACKAGED_EXECUTABLE
const assemblyPath = path.resolve(import.meta.dirname, '../../../backend/dnSpy.Backend.Contracts/bin/Debug/net10.0/dnSpy.Backend.Contracts.dll')

test('packaged application starts its bundled backend and discovers the debugger', async () => {
  test.skip(!executable, 'DNSPY_PACKAGED_EXECUTABLE is not set.')
  const port = await getFreePort()
  const userDataDirectory = mkdtempSync(path.join(os.tmpdir(), 'dnspy-packaged-e2e-'))
  let application: ChildProcess | undefined
  let browser: Browser | undefined
  let applicationProcessId: number | undefined
  application = spawn(executable!, [
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDirectory}`,
    '--open',
    assemblyPath,
  ], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  try {
    browser = await connectToApplication(port)
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? await context.waitForEvent('page')
    applicationProcessId = await page.evaluate(() => window.dnSpy.getProcessId())
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await expect(page.getByRole('toolbar', { name: 'Main toolbar' }).getByRole('button', { name: 'Debug a Program' })).toBeEnabled()
    if (!executable!.endsWith('.AppImage')) {
      const resourcesPath = path.join(path.dirname(executable!), 'resources')
      await access(path.join(resourcesPath, 'backend', 'linux-x64', 'dnSpy.Backend.Host'))
      await access(path.join(resourcesPath, 'backend', 'linux-x64', 'libdbgshim.so'))
    }
    await expect(page.getByRole('treeitem').first()).toContainText('dnSpy.Backend.Contracts')
    // The assembly opens as one collapsed root over its module, and the namespaces hang off the module.
    for (const kind of ['assembly', 'module']) {
      const row = page.locator(`.tree-row[data-kind="${kind}"]`).first()
      await expect(row).toBeVisible()
      if ((await row.getAttribute('aria-expanded')) === 'false')
        await row.locator('.tree-expander').click({ force: true })
    }
    const namespaceRow = page.locator('.tree-row[data-kind="namespace"]').filter({ hasText: /^dnSpy\.Backend\.Contracts$/ })
    await expect(namespaceRow).toBeVisible()
    await namespaceRow.locator('.tree-expander').click({ force: true })
    await expect(namespaceRow).toHaveAttribute('aria-expanded', 'true')
    const helloRequest = page.locator('.tree-row[data-kind="type"]').filter({ hasText: /^HelloRequest @02000005$/ })
    await expect(helloRequest).toBeVisible()
    await helloRequest.dblclick({ force: true })
    await expect(page.locator('.monaco-editor')).toBeVisible()
  } finally {
    await browser?.close()
    await stopProcessId(applicationProcessId)
    await stopProcess(application)
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

const getFreePort = async (): Promise<number> => await new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      reject(new Error('Could not allocate a debugging port.'))
      return
    }
    server.close((error) => error ? reject(error) : resolve(address.port))
  })
})

const connectToApplication = async (port: number): Promise<Browser> => {
  const deadline = Date.now() + 15_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The packaged application did not expose its renderer debugging endpoint.')
}

const stopProcessId = async (processId: number | undefined): Promise<void> => {
  if (!processId) return
  try { process.kill(processId, 'SIGTERM') } catch { return }
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    try { process.kill(processId, 0) } catch { return }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  try { process.kill(processId, 'SIGKILL') } catch { /* already exited */ }
}

const stopProcess = async (application: ChildProcess | undefined): Promise<void> => {
  if (!application || application.exitCode !== null)
    return
  const exited = new Promise<void>((resolve) => application.once('exit', () => resolve()))
  signalProcessGroup(application, 'SIGTERM')
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))])
  if (application.exitCode === null) {
    signalProcessGroup(application, 'SIGKILL')
    await exited
  }
}

const signalProcessGroup = (application: ChildProcess, signal: NodeJS.Signals): void => {
  try {
    if (application.pid) process.kill(-application.pid, signal)
    else application.kill(signal)
  } catch {
    application.kill(signal)
  }
}
