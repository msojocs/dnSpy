import type { ImplMapDto } from '../../../../shared/protocol'

/**
 * dnlib's `PInvokeAttributes`. The word is a set of bit fields of different widths, and dnSpy's control
 * shows each of them as a combo, so the pieces below are what the editor reads and writes it with.
 */
export const P_INVOKE = {
  NoMangle: 0x0001,
  CharSetAnsi: 0x0002,
  CharSetUnicode: 0x0004,
  CharSetAuto: 0x0006,
  CharSetMask: 0x0006,
  BestFitEnabled: 0x0010,
  BestFitDisabled: 0x0020,
  BestFitMask: 0x0030,
  SupportsLastError: 0x0040,
  CallConvWinapi: 0x0100,
  CallConvCdecl: 0x0200,
  CallConvStdcall: 0x0300,
  CallConvThiscall: 0x0400,
  CallConvFastcall: 0x0500,
  CallConvMask: 0x0700,
  ThrowOnUnmappableCharEnabled: 0x1000,
  ThrowOnUnmappableCharDisabled: 0x2000,
  ThrowOnUnmappableCharMask: 0x3000,
} as const

/**
 * One of the four combos. dnSpy declares a small enum per field whose members are the attribute word's
 * own values shifted down, and lists it through `EnumVM.Create`, which sorts by name — so the entries
 * here are in that order, not in the order of the values.
 */
export interface PInvokeField {
  /** What the label says, which is dnSpy's literal XAML text — `ThrowOn...` is its own abbreviation. */
  label: string
  /** What the label's tooltip spells out, for the one field whose label is abbreviated. */
  tooltip?: string
  mask: number
  shift: number
  entries: { name: string, value: number }[]
}

export const P_INVOKE_FIELDS: PInvokeField[] = [
  {
    label: 'CharSet',
    mask: P_INVOKE.CharSetMask,
    shift: 1,
    entries: [
      { name: 'Ansi', value: P_INVOKE.CharSetAnsi >> 1 },
      { name: 'Auto', value: P_INVOKE.CharSetAuto >> 1 },
      { name: 'NotSpec', value: 0 },
      { name: 'Unicode', value: P_INVOKE.CharSetUnicode >> 1 },
    ],
  },
  {
    label: 'BestFit',
    mask: P_INVOKE.BestFitMask,
    shift: 4,
    entries: [
      { name: 'Disabled', value: P_INVOKE.BestFitDisabled >> 4 },
      { name: 'Enabled', value: P_INVOKE.BestFitEnabled >> 4 },
      { name: 'UseAssem', value: 0 },
    ],
  },
  {
    label: 'ThrowOn...',
    tooltip: 'ThrowOnUnmappableChar',
    mask: P_INVOKE.ThrowOnUnmappableCharMask,
    shift: 12,
    entries: [
      { name: 'Disabled', value: P_INVOKE.ThrowOnUnmappableCharDisabled >> 12 },
      { name: 'Enabled', value: P_INVOKE.ThrowOnUnmappableCharEnabled >> 12 },
      { name: 'UseAssem', value: 0 },
    ],
  },
  {
    label: 'CallConv',
    mask: P_INVOKE.CallConvMask,
    shift: 8,
    entries: [
      { name: 'Cdecl', value: P_INVOKE.CallConvCdecl >> 8 },
      { name: 'Fastcall', value: P_INVOKE.CallConvFastcall >> 8 },
      { name: 'Stdcall', value: P_INVOKE.CallConvStdcall >> 8 },
      { name: 'Thiscall', value: P_INVOKE.CallConvThiscall >> 8 },
      { name: 'Winapi', value: P_INVOKE.CallConvWinapi >> 8 },
    ],
  },
]

/** What the word holds for one field, shifted down into the small enum's range. */
export const fieldValue = (attributes: number, field: PInvokeField): number =>
  (attributes & field.mask) >> field.shift

/**
 * What the field's combo offers for a word. A value the four small enums do not name — written by
 * another tool, since these bit fields are shared with flags dnSpy's combos never set — is appended as
 * an entry of its own, hex-labelled, which is what `EnumListVM.GetIndex` does with an unknown value:
 * it adds `new EnumVM(value, "0x" + value.ToString("X"))` rather than refusing to select it.
 */
export const fieldEntries = (field: PInvokeField, value: number): { name: string, value: number }[] =>
  field.entries.some((entry) => entry.value === value)
    ? field.entries
    : [...field.entries, { name: `0x${value.toString(16).toUpperCase()}`, value }]

/** The word with one field replaced, and every other bit — the two standalone flags included — kept. */
export const withFieldValue = (attributes: number, field: PInvokeField, value: number): number =>
  (attributes & ~field.mask) | (value << field.shift)

export const hasFlag = (attributes: number, flag: number): boolean => (attributes & flag) !== 0

export const withFlag = (attributes: number, flag: number, on: boolean): number =>
  on ? attributes | flag : attributes & ~flag

/** A fresh row, which is dnSpy's `ImplMapVM` defaults: an empty name, an empty library, no attributes. */
export const newImplMap = (): ImplMapDto => ({ attributes: 0, name: '', moduleName: '' })

/** What would keep the backend from writing this row — a P/Invoke without a library to call into. */
export const implMapError = (value: ImplMapDto | undefined): string | undefined =>
  value !== undefined && (value.moduleName ?? '') === ''
    ? 'A P/Invoke method needs the name of the native library it calls into.'
    : undefined
