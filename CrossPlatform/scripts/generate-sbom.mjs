import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAllDocuments } from 'yaml'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDirectory = resolve(scriptDirectory, '..')
const components = new Map()

// Which backend build this bill of materials describes, and what version to record for the app. The
// directory name is the one the publish wrote to — `linux-x64`, `win32-x64`, `darwin-arm64` — and it
// decides which native shim is recorded below, so the document describes the package that is actually
// shipping rather than the one we are on. The version is passed in rather than read from the
// environment because scripts/package-platform.mjs is what knows it; omitted, the repository's own
// version is used, which is what a branch build has.
const backendDirectory = process.argv[2]
if (!backendDirectory) {
  console.error('Usage: node scripts/generate-sbom.mjs <backend directory name, e.g. linux-x64> [version]')
  process.exit(1)
}
const backendOutput = resolve(rootDirectory, 'artifacts/publish/backend', backendDirectory)

const findFile = (directory, pattern) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const found = findFile(path, pattern)
      if (found) return found
    }
    else if (pattern.test(entry.name))
      return path
  }
  return undefined
}

const addComponent = (ecosystem, name, version, extra = {}) => {
  if (!name || !version) return
  const purlName = ecosystem === 'npm' ? name.replace('@', '%40') : name
  const purl = `pkg:${ecosystem}/${purlName}@${version}`
  components.set(purl, {
    type: 'library',
    'bom-ref': purl,
    name,
    version,
    purl,
    ...extra,
  })
}

const lockDocuments = parseAllDocuments(readFileSync(resolve(rootDirectory, 'pnpm-lock.yaml'), 'utf8'))
for (const document of lockDocuments) {
  if (document.errors.length > 0)
    throw document.errors[0]
  const lock = document.toJSON()
  for (const packageKey of Object.keys(lock.packages ?? {})) {
    const normalized = packageKey.replace(/\(.+$/, '')
    const separator = normalized.lastIndexOf('@')
    if (separator <= 0) continue
    addComponent('npm', normalized.slice(0, separator), normalized.slice(separator + 1))
  }
}

const assets = JSON.parse(readFileSync(resolve(rootDirectory, 'backend/dnSpy.Backend.Host/obj/project.assets.json'), 'utf8'))
for (const library of Object.values(assets.libraries ?? {})) {
  if (library.type !== 'package') continue
  const separator = library.path.lastIndexOf('/')
  addComponent('nuget', library.path.slice(0, separator), library.path.slice(separator + 1))
}

// The debug engine's only native dependency is a single file that arrives with the backend publish.
// It is recorded from the file on disk — name, version and hash — because all three differ per
// platform and the point of listing it is to describe what a verifier would find in this package.
const dbgShim = findFile(backendOutput, /^(lib)?dbgshim\.(so|dylib|dll)$/)
if (!dbgShim) {
  console.error(`No DbgShim library was found under ${backendOutput}.`)
  process.exit(1)
}
const dbgShimLibrary = Object.entries(assets.libraries ?? {})
  .find(([name]) => name.startsWith('Microsoft.Diagnostics.DbgShim.'))
if (!dbgShimLibrary) {
  console.error('Microsoft.Diagnostics.DbgShim was not in the restored packages, so its version is unknown.')
  process.exit(1)
}
const dbgShimPackage = dbgShimLibrary[0]
const dbgShimVersion = dbgShimLibrary[1].path.slice(dbgShimLibrary[1].path.lastIndexOf('/') + 1)
addComponent('generic', basename(dbgShim).replace(/\.(so|dylib|dll)$/, ''), dbgShimVersion, {
  hashes: [{ alg: 'SHA-256', content: createHash('sha256').update(readFileSync(dbgShim)).digest('hex') }],
  licenses: [{ license: { id: 'MIT' } }],
  properties: [{ name: 'nuget:package', value: dbgShimPackage }],
})

// The version the app reports about itself. A packaged release is stamped with the tag it was built
// from, and the SBOM has to agree with the packages beside it.
const appVersion = process.argv[3]
  || JSON.parse(readFileSync(resolve(rootDirectory, 'frontend/package.json'), 'utf8')).version

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      name: 'dnSpy',
      version: appVersion,
      licenses: [{ license: { id: 'GPL-3.0-only' } }],
    },
  },
  components: [...components.values()].sort((left, right) => left.purl.localeCompare(right.purl)),
}

const destination = resolve(rootDirectory, 'artifacts/sbom/dnSpy.cdx.json')
mkdirSync(dirname(destination), { recursive: true })
writeFileSync(destination, `${JSON.stringify(bom, null, 2)}\n`)
console.log(destination)
