/**
 * dnSpy's `SimpleTypeConverter`, as far as its numeric boxes need it: how a number is written into one
 * and what the text in one may look like. Every dialog's number box goes through this — the parameter
 * sequence, a marshal type's size — so the same text reads the same way wherever it is typed.
 */

import type { CaError } from './ca-value'

/**
 * The values dnSpy prints as decimal. It is not a range but a short list of round numbers — 0 to 21, and
 * each power of ten with its neighbours — because `SimpleTypeConverter.ToString` uses decimal only when
 * a value is one of them and hex otherwise: `4095` is written `0xFFF` in the box while `1000` stays as it
 * is. The list is built the same way here, up to the largest value any of these boxes can hold.
 */
const DECIMAL_UNSIGNED = new Set<number>([...Array.from({ length: 21 }, (_, index) => index), 21])
for (let power = 10; power <= 0xFFFFFFFF; power *= 10) {
  DECIMAL_UNSIGNED.add(power - 1)
  DECIMAL_UNSIGNED.add(power)
  DECIMAL_UNSIGNED.add(power + 1)
}

/** How a value is written into one of the boxes: `SimpleTypeConverter.ToString(value, min, max, null)`. */
export const formatNumberText = (value: number): string =>
  DECIMAL_UNSIGNED.has(value) ? String(value) : `0x${value.toString(16).toUpperCase()}`

/** Why the text in a box could not be read, which is the message its caller shows. */
export type NumberError = 'negative' | 'notANumber' | 'range'

/**
 * What the text in a box reads as. An empty result is an empty box, which for a nullable box is the
 * value not being there at all and for a plain one is an error — the caller knows which it has.
 *
 * The acceptd forms are dnSpy's: decimal, `0x`/`&H` hex, and `_` anywhere as a digit separator.
 */
export const parseNumberText = (text: string, max: number): { value?: number, error?: NumberError } => {
  const trimmed = text.trim().replaceAll('_', '')
  if (trimmed.length === 0)
    return {}
  if (trimmed.startsWith('-'))
    return { error: 'negative' }
  const hexadecimal = /^(0x|&h)/i.test(trimmed)
  const digits = hexadecimal ? trimmed.slice(2) : trimmed
  // A hex prefix admits digits and letters; there is no whitespace inside either form.
  if (digits.length === 0 || digits.trim() !== digits || !(hexadecimal ? /^[0-9a-f]+$/i : /^\d+$/).test(digits))
    return { error: 'notANumber' }
  const value = Number.parseInt(digits, hexadecimal ? 16 : 10)
  return value <= max ? { value } : { error: 'range' }
}

/** The message a box's error gets, with the placeholders its callers fill in. */
export const numberErrorTemplate = (error: NumberError): string =>
  error === 'negative'
    ? 'Only non-negative integers are allowed'
    : error === 'notANumber'
      ? 'The value is not an unsigned hexadecimal or decimal integer'
      : 'Value must be between {min} and {max} (0x{maxHex}) inclusive'

/**
 * Why a box that has to hold a number cannot be read, which every one of them reports the same way: the
 * message its value's own error gives, with the range filled in for the one that needs it.
 *
 * An empty box is an error here and not an absent value: a parameter has a sequence and a generic
 * parameter has a number whether or not the box says one, so a box that says nothing is not read at all.
 */
export const unsignedIntegerFailure = (text: string, max: number): CaError | undefined => {
  const parsed = parseNumberText(text, max)
  if (parsed.error === undefined)
    return text.trim().length === 0 ? { template: numberErrorTemplate('notANumber') } : undefined
  return parsed.error === 'range'
    ? { template: numberErrorTemplate('range'), args: { min: '0', max: String(max), maxHex: max.toString(16).toUpperCase() } }
    : { template: numberErrorTemplate(parsed.error) }
}
