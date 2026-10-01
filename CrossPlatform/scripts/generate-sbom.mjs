import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAllDocuments } from 'yaml'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDirectory = resolve(scriptDirectory, '..')
const components = new Map()

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

addComponent('generic', 'netcoredbg', '3.2.0-1092', {
  hashes: [{ alg: 'SHA-256', content: '080eb3b2d2152465f599d3b33d1ee6e747794e11cc0a3773ec689f5e5f2c5afa' }],
  licenses: [{ license: { id: 'MIT' } }],
})

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
      version: '1.0.0',
      licenses: [{ license: { id: 'GPL-3.0-only' } }],
    },
  },
  components: [...components.values()].sort((left, right) => left.purl.localeCompare(right.purl)),
}

const destination = resolve(rootDirectory, 'artifacts/sbom/dnSpy.cdx.json')
mkdirSync(dirname(destination), { recursive: true })
writeFileSync(destination, `${JSON.stringify(bom, null, 2)}\n`)
console.log(destination)
