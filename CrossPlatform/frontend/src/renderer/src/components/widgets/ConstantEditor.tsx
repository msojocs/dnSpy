import type { ConstantDto } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import type { CaError } from './ca-value'

/**
 * The literal kinds dnSpy's `ConstantVM` offers, in the order its combo lists them. The names are the
 * ones its `typeToEnumVM` table displays and the element types are dnlib's, which is what travels in
 * the DTO — `ConstantDto.elementType` is an `ElementType` as an int.
 *
 * `null` is dnSpy's `ConstantType.Null`: a constant that holds no value at all. It is `ElementType.Void`
 * here, and the backend drops such a row rather than writing an empty one, so picking it and accepting
 * leaves the item without a default value — the same place unticking Constant lands.
 */
const CONSTANT_TYPES: { name: string, elementType: number }[] = [
  { name: 'null', elementType: 0x01 },
  { name: 'Boolean', elementType: 0x02 },
  { name: 'Char', elementType: 0x03 },
  { name: 'SByte', elementType: 0x04 },
  { name: 'Byte', elementType: 0x05 },
  { name: 'Int16', elementType: 0x06 },
  { name: 'UInt16', elementType: 0x07 },
  { name: 'Int32', elementType: 0x08 },
  { name: 'UInt32', elementType: 0x09 },
  { name: 'Int64', elementType: 0x0A },
  { name: 'UInt64', elementType: 0x0B },
  { name: 'Single', elementType: 0x0C },
  { name: 'Double', elementType: 0x0D },
  { name: 'String', elementType: 0x0E },
]

const typeOf = (elementType: number): { name: string, elementType: number } | undefined =>
  CONSTANT_TYPES.find((entry) => entry.elementType === elementType)

/** The name a literal's error message calls the kind it could not read, e.g. `Int32`. */
export const constantTypeName = (elementType: number): string => typeOf(elementType)?.name ?? String(elementType)

/** The ranges dnlib's parsers accept, which is what the value has to fit in. */
const INTEGRAL_RANGES: Record<number, [number, number]> = {
  0x04: [-0x80, 0x7F],
  0x05: [0, 0xFF],
  0x06: [-0x8000, 0x7FFF],
  0x07: [0, 0xFFFF],
  0x08: [-0x80000000, 0x7FFFFFFF],
  0x09: [0, 0xFFFFFFFF],
  0x0A: [-0x8000000000000000, 0x7FFFFFFFFFFFFFFF],
  0x0B: [0, 0xFFFFFFFFFFFFFFFF],
}

/** The message an unreadable value gets, with the two placeholders its callers fill in. */
const NOT_A_VALUE = "'{text}' is not a valid {name}"

/**
 * What the backend's own parser would make of the text, checked before it is sent rather than after it
 * fails. The value travels as invariant text because the element type is what says how to read it back,
 * so a value the parser rejects is a value this editor has to reject first. Returns the message template,
 * with `{text}` and `{name}` still in it, or undefined when the value reads.
 *
 * Custom attribute arguments are literals of the same shape under a different declared type, so they use
 * this too rather than a second set of rules that could drift from it.
 */
export const literalError = (elementType: number, text: string): string | undefined => {
  const range = INTEGRAL_RANGES[elementType]
  if (range) {
    return /^-?\d+$/.test(text) && Number(text) >= range[0] && Number(text) <= range[1] ? undefined : NOT_A_VALUE
  }
  switch (elementType) {
    case 0x02:
      return text === 'true' || text === 'false' ? undefined : NOT_A_VALUE
    case 0x03:
      // dnSpy takes the first character of whatever was typed; one character is the only
      // unambiguous way to say which one.
      return [...text].length === 1 ? undefined : NOT_A_VALUE
    case 0x0C:
    case 0x0D:
      return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text) || text === 'NaN' || text === 'Infinity' || text === '-Infinity' ? undefined : NOT_A_VALUE
    default:
      // String, and the element types the combo cannot show at all — <c>System.Object</c>, a type, an
      // array. There is nothing to check against, which is also what the backend finds when it reads
      // one back.
      return undefined
  }
}

/** The same check over a whole constant, where a `null` kind and an absent constant both read fine. */
export const constantError = (value: ConstantDto | null): string | undefined =>
  value === null || value.elementType === 0x01 ? undefined : literalError(value.elementType, value.value ?? '')

/** The same check with the placeholders filled in, for a dialog that has an error line of its own to
 * put the message on. */
export const constantFailure = (value: ConstantDto | null): CaError | undefined => {
  const template = constantError(value)
  return template === undefined
    ? undefined
    : { template, args: { text: value?.value ?? '', name: constantTypeName(value?.elementType ?? 0x08) } }
}

interface ConstantEditorProps {
  /** The constant, or null when the item has none. */
  value: ConstantDto | null
  onChange(value: ConstantDto | null): void
  /** What the Constant checkbox says. dnSpy's label is `Constant` for every caller; what changes is the
   * tooltip beside it. */
  label?: string
  /** The checkbox's tooltip, which is how dnSpy says what the value is for: a field's default value, a
   * parameter's. */
  tooltip?: string
  disabled?: boolean
}

/**
 * dnSpy's `ConstantControl`: a Constant checkbox, then the `ConstantTypeControl` it enables — a combo
 * of the literal kinds and a box for the value in the form the kind reads.
 */
export const ConstantEditor = ({ value, onChange, label, tooltip, disabled = false }: ConstantEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const enabled = !disabled && value !== null
  const elementType = value?.elementType ?? 0x08
  const isNull = elementType === 0x01
  const error = constantFailure(value)
  const caption = label ?? 'Constant'

  /** A different kind keeps the text: what was typed as an Int32 is very often what an Int64 wants. */
  const changeType = (next: number): void => { onChange({ elementType: next, value: value?.value }) }

  return (
    <div className="constant-editor">
      <label className="options-row" title={tooltip ? t(tooltip) : undefined}>
        <input type="checkbox" checked={value !== null} disabled={disabled} onChange={(event) => { onChange(event.target.checked ? { elementType, value: value?.value ?? '' } : null) }} />
        {t(caption)}
      </label>
      <div className="constant-value">
        <select aria-label={t('Value type')} title={t('Value type')} value={elementType} disabled={!enabled} onChange={(event) => { changeType(Number(event.target.value)) }}>
          {CONSTANT_TYPES.map((entry) => <option key={entry.elementType} value={entry.elementType}>{entry.name}</option>)}
        </select>
        {/* dnSpy keeps the box in the layout for null rather than moving the row around. */}
        <span className="constant-value-label">{isNull ? 'null' : t('Value')}</span>
        {!isNull && (
          <input
            aria-label={t('Value')}
            value={value?.value ?? ''}
            disabled={!enabled}
            onChange={(event) => { onChange({ elementType, value: event.target.value }) }}
          />
        )}
      </div>
      {error && <div className="options-error">{t(error.template, error.args)}</div>}
    </div>
  )
}
