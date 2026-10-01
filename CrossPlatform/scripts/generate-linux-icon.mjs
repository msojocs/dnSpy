import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDirectory = resolve(scriptDirectory, '..')
const source = readFileSync(resolve(rootDirectory, '../dnSpy/dnSpy/Images/dnSpy.ico'))
const imageOffset = source.readUInt32LE(18)
const dibSize = source.readUInt32LE(imageOffset)
const width = source.readInt32LE(imageOffset + 4)
const height = Math.abs(source.readInt32LE(imageOffset + 8)) / 2
const bitsPerPixel = source.readUInt16LE(imageOffset + 14)

if (dibSize !== 40 || width !== 128 || height !== 128 || bitsPerPixel !== 32)
  throw new Error('The upstream dnSpy icon is not the expected 128x128 BGRA bitmap.')

const pixelsOffset = imageOffset + dibSize
const scanlines = Buffer.alloc((width * 4 + 1) * height)
for (let outputY = 0; outputY < height; outputY++) {
  const sourceY = height - outputY - 1
  const outputRow = outputY * (width * 4 + 1)
  scanlines[outputRow] = 0
  for (let x = 0; x < width; x++) {
    const sourcePixel = pixelsOffset + (sourceY * width + x) * 4
    const outputPixel = outputRow + 1 + x * 4
    scanlines[outputPixel] = source[sourcePixel + 2]
    scanlines[outputPixel + 1] = source[sourcePixel + 1]
    scanlines[outputPixel + 2] = source[sourcePixel]
    scanlines[outputPixel + 3] = source[sourcePixel + 3]
  }
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

const chunk = (type, data) => {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  let crc = 0xFFFFFFFF
  for (const byte of Buffer.concat([typeBytes, data])) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0)
  return Buffer.concat([length, typeBytes, data, checksum])
}

const header = Buffer.alloc(13)
header.writeUInt32BE(width, 0)
header.writeUInt32BE(height, 4)
header[8] = 8
header[9] = 6

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(scanlines, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
const destination = resolve(rootDirectory, 'packaging/linux/icons/128x128.png')
mkdirSync(dirname(destination), { recursive: true })
writeFileSync(destination, png)
console.log(destination)
