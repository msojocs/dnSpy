// Produces the application icons the packages need, from the only artwork the repository has: the
// upstream WPF app's 128x128 .ico. The two outputs have different jobs and different sources on
// purpose — see the comments at the bottom of this file.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDirectory = resolve(scriptDirectory, '..')

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

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

/** Encodes straight (non-premultiplied) 8-bit RGBA pixels as a PNG. */
const encodePng = (image) => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(image.width, 0)
  header.writeUInt32BE(image.height, 4)
  header[8] = 8
  header[9] = 6
  const scanlines = Buffer.alloc((image.width * 4 + 1) * image.height)
  for (let y = 0; y < image.height; y++) {
    const outputRow = y * (image.width * 4 + 1)
    scanlines[outputRow] = 0
    image.pixels.copy(scanlines, outputRow + 1, y * image.width * 4, (y + 1) * image.width * 4)
  }
  return Buffer.concat([pngSignature, chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/**
 * Reads the 128x128 32-bit bitmap out of the upstream .ico, which holds a single uncompressed
 * BGRA bottom-up DIB. Throws rather than guessing when upstream changes the artwork's shape.
 */
const readUpstreamIcon = () => {
  const source = readFileSync(resolve(rootDirectory, '../dnSpy/dnSpy/Images/dnSpy.ico'))
  const imageOffset = source.readUInt32LE(18)
  const dibSize = source.readUInt32LE(imageOffset)
  const width = source.readInt32LE(imageOffset + 4)
  const height = Math.abs(source.readInt32LE(imageOffset + 8)) / 2
  const bitsPerPixel = source.readUInt16LE(imageOffset + 14)

  if (dibSize !== 40 || width !== 128 || height !== 128 || bitsPerPixel !== 32)
    throw new Error('The upstream dnSpy icon is not the expected 128x128 BGRA bitmap.')

  const pixelsOffset = imageOffset + dibSize
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sourceY = height - y - 1
    for (let x = 0; x < width; x++) {
      const sourcePixel = pixelsOffset + (sourceY * width + x) * 4
      const outputPixel = (y * width + x) * 4
      pixels[outputPixel] = source[sourcePixel + 2]
      pixels[outputPixel + 1] = source[sourcePixel + 1]
      pixels[outputPixel + 2] = source[sourcePixel]
      pixels[outputPixel + 3] = source[sourcePixel + 3]
    }
  }
  return { width, height, pixels }
}

const weight = (t) => {
  const x = Math.abs(t)
  if (x <= 1) return 1.5 * x * x * x - 2.5 * x * x + 1
  if (x < 2) return -0.5 * x * x * x + 2.5 * x * x - 4 * x + 2
  return 0
}

/**
 * Catmull-Rom resample, separable and edge-clamped. Colors are premultiplied first so the
 * transparent surround of the artwork cannot bleed its RGB into the edges of the upscaled icon.
 */
const resize = (image, width, height) => {
  const { pixels } = image
  const premultiplied = Buffer.alloc(pixels.length)
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255
    premultiplied[index] = Math.round(pixels[index] * alpha)
    premultiplied[index + 1] = Math.round(pixels[index + 1] * alpha)
    premultiplied[index + 2] = Math.round(pixels[index + 2] * alpha)
    premultiplied[index + 3] = pixels[index + 3]
  }

  // One separable pass: the same kernel and weight function run per axis, over the four channels at once.
  const pass = (source, sourceWidth, sourceHeight, target, targetWidth, targetHeight) => {
    for (let y = 0; y < targetHeight; y++) {
      const sourceY = Math.min(sourceHeight - 1, Math.max(0, ((y + 0.5) * sourceHeight) / targetHeight - 0.5))
      const baseY = Math.floor(sourceY)
      for (let x = 0; x < targetWidth; x++) {
        const sourceX = Math.min(sourceWidth - 1, Math.max(0, ((x + 0.5) * sourceWidth) / targetWidth - 0.5))
        const baseX = Math.floor(sourceX)
        const sums = [0, 0, 0, 0]
        let total = 0
        for (let ky = -1; ky <= 2; ky++) {
          const sy = Math.min(sourceHeight - 1, Math.max(0, baseY + ky))
          const weightY = weight(sourceY - (baseY + ky))
          if (weightY === 0) continue
          for (let kx = -1; kx <= 2; kx++) {
            const sx = Math.min(sourceWidth - 1, Math.max(0, baseX + kx))
            const kernel = weightY * weight(sourceX - (baseX + kx))
            if (kernel === 0) continue
            const sourcePixel = (sy * sourceWidth + sx) * 4
            for (let channel = 0; channel < 4; channel++)
              sums[channel] += kernel * source[sourcePixel + channel]
            total += kernel
          }
        }
        const targetPixel = (y * targetWidth + x) * 4
        for (let channel = 0; channel < 4; channel++)
          target[targetPixel + channel] = total === 0 ? 0 : Math.min(255, Math.max(0, Math.round(sums[channel] / total)))
      }
    }
  }

  const horizontalPass = Buffer.alloc(width * image.height * 4)
  pass(premultiplied, image.width, image.height, horizontalPass, width, image.height)
  const resampled = Buffer.alloc(width * height * 4)
  pass(horizontalPass, width, image.height, resampled, width, height)

  const output = Buffer.alloc(resampled.length)
  for (let index = 0; index < output.length; index += 4) {
    const alpha = resampled[index + 3]
    if (alpha === 0) continue
    const ratio = 255 / alpha
    output[index] = Math.min(255, Math.round(resampled[index] * ratio))
    output[index + 1] = Math.min(255, Math.round(resampled[index + 1] * ratio))
    output[index + 2] = Math.min(255, Math.round(resampled[index + 2] * ratio))
    output[index + 3] = alpha
  }
  return { width, height, pixels: output }
}

const write = (relativePath, buffer) => {
  const destination = resolve(rootDirectory, relativePath)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, buffer)
  console.log(destination)
}

// The Linux desktop icon is the upstream bitmap itself, at the size upstream drew it: electron-builder
// takes a directory of PNGs for `linux.icon`, and hand-picking from the source keeps it pixel exact.
const upstream = readUpstreamIcon()
write('packaging/linux/icons/128x128.png', encodePng(upstream))

// Windows and macOS installers need an icon far larger than the 128x128 artwork that exists, and
// electron-builder converts a PNG into the .ico/.icns they want. This file is the app icon from here
// on: it is generated once, and replacing it with real hi-res artwork is the intended way to change
// the icon (nothing overwrites it afterwards). Only the absence of it triggers the upscale below.
const appIconPath = resolve(rootDirectory, 'packaging/icons/icon.png')
if (existsSync(appIconPath))
  console.log(`${appIconPath} already exists; keeping it`)
else {
  // Upscaled rather than blocky: the artwork is a smooth logo, and the installers are the only
  // consumers, so a soft 1024x1024 beats the same pixels repeated eight times over.
  write('packaging/icons/icon.png', encodePng(resize(upstream, 1024, 1024)))
}
