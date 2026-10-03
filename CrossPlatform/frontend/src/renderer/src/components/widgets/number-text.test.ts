import { describe, expect, it } from 'vitest'
import { formatNumberText, numberErrorTemplate, parseNumberText } from './number-text'
import { COMPRESSED_UINT32_MAX } from './marshal-type'

const SEQUENCE_MAX = 0xFFFF

describe('what a number box shows', () => {
  it('prints the round values as decimal, which is dnSpy\'s own list of them', () => {
    // 0..21 and each power of ten with its neighbours; everything else comes out in hex.
    for (const value of [0, 1, 9, 10, 11, 21, 99, 100, 101, 999, 1000, 1001])
      expect(formatNumberText(value)).toBe(String(value))
  })

  it('prints everything else in upper-case hex, a full range of 65535 included', () => {
    expect(formatNumberText(22)).toBe('0x16')
    expect(formatNumberText(65535)).toBe('0xFFFF')
    expect(formatNumberText(4095)).toBe('0xFFF')
    expect(formatNumberText(4096)).toBe('0x1000')
    expect(formatNumberText(COMPRESSED_UINT32_MAX)).toBe('0x1FFFFFFF')
  })
})

describe('reading a number box', () => {
  it('reads decimal', () => {
    expect(parseNumberText('0', COMPRESSED_UINT32_MAX)).toEqual({ value: 0 })
    expect(parseNumberText(' 42 ', COMPRESSED_UINT32_MAX)).toEqual({ value: 42 })
    expect(parseNumberText(String(COMPRESSED_UINT32_MAX), COMPRESSED_UINT32_MAX)).toEqual({ value: COMPRESSED_UINT32_MAX })
  })

  it('reads the two hex forms dnSpy accepts', () => {
    expect(parseNumberText('0xFFF', COMPRESSED_UINT32_MAX)).toEqual({ value: 4095 })
    expect(parseNumberText('0xfff', COMPRESSED_UINT32_MAX)).toEqual({ value: 4095 })
    expect(parseNumberText('&H10', COMPRESSED_UINT32_MAX)).toEqual({ value: 16 })
    expect(parseNumberText('&h10', COMPRESSED_UINT32_MAX)).toEqual({ value: 16 })
  })

  it('ignores the digit separators', () => {
    expect(parseNumberText('1_000', COMPRESSED_UINT32_MAX)).toEqual({ value: 1000 })
    expect(parseNumberText('0xFF_FF', SEQUENCE_MAX)).toEqual({ value: 0xFFFF })
  })

  it('reads an empty box as nothing at all, which the caller decides the meaning of', () => {
    expect(parseNumberText('', COMPRESSED_UINT32_MAX)).toEqual({})
    expect(parseNumberText('   ', COMPRESSED_UINT32_MAX)).toEqual({})
  })

  it('says why it refused the text, so the box can repeat it', () => {
    expect(parseNumberText('-1', COMPRESSED_UINT32_MAX)).toEqual({ error: 'negative' })
    expect(parseNumberText('abc', COMPRESSED_UINT32_MAX)).toEqual({ error: 'notANumber' })
    expect(parseNumberText('1.5', COMPRESSED_UINT32_MAX)).toEqual({ error: 'notANumber' })
    expect(parseNumberText('0x', COMPRESSED_UINT32_MAX)).toEqual({ error: 'notANumber' })
    expect(parseNumberText('1 000', COMPRESSED_UINT32_MAX)).toEqual({ error: 'notANumber' })
    expect(parseNumberText('0xG', COMPRESSED_UINT32_MAX)).toEqual({ error: 'notANumber' })
    expect(parseNumberText(String(COMPRESSED_UINT32_MAX + 1), COMPRESSED_UINT32_MAX)).toEqual({ error: 'range' })
    expect(parseNumberText('65536', SEQUENCE_MAX)).toEqual({ error: 'range' })
  })

  it('reads the boundary as inside the range at either end', () => {
    expect(parseNumberText('65535', SEQUENCE_MAX)).toEqual({ value: 65535 })
    expect(parseNumberText('65536', SEQUENCE_MAX)).toEqual({ error: 'range' })
  })
})

describe('the message a box gets', () => {
  it('is dnSpy\'s own wording, with the range one left for the caller to fill in', () => {
    expect(numberErrorTemplate('negative')).toBe('Only non-negative integers are allowed')
    expect(numberErrorTemplate('notANumber')).toBe('The value is not an unsigned hexadecimal or decimal integer')
    expect(numberErrorTemplate('range')).toBe('Value must be between {min} and {max} (0x{maxHex}) inclusive')
  })
})
