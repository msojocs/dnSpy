import { useEffect, useState } from 'react'
import type { MarshalTypeDto } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import { TypeSigEditor, type TypeSigEditorOptions } from './TypeSigEditor'
import {
  COMPRESSED_UINT32_MAX, DEFAULT_NATIVE_TYPE, ELEMENT_TYPES, hexOfRawData, isArray, isCustomMarshaler, isFixedArray,
  isFixedSysString, isInterface, isRawMarshalType, isSafeArray, NATIVE_TYPE, NATIVE_TYPES, newMarshalType,
  rawDataOfHex, VARIANT_FLAGS, VARIANT_TYPE, VARIANT_TYPE_MASK, VARIANT_TYPES,
} from './marshal-type'
import { formatNumberText, parseNumberText } from './number-text'

interface MarshalTypeEditorProps {
  workspaceId: string
  /** The marshal type, or undefined when the item has none — which is what the Enable checkbox says. */
  value: MarshalTypeDto | undefined
  onChange(value: MarshalTypeDto | undefined): void
  /** What the two embedded signature editors may hold; a marshal type has no generic parameters of its
   * own, so the caller's owner type and method are what they are read against. */
  options?: TypeSigEditorOptions
  disabled?: boolean
}

/** The fields a box is typed into, since none of them can be read out of the value while it is being
 * typed — half a number is not a number. */
type TextField = 'rawData' | 'size' | 'paramNumber' | 'numberOfElements' | 'flags' | 'iidParamIndex'

/** The flags of a safe array's variant type, which travel in its top bits. */
const variantFlags = (variantType: number): number => variantType > 0 ? variantType & ~VARIANT_TYPE_MASK : 0

/**
 * dnSpy's `MarshalTypeControl`: an Enable checkbox, the native type it marshals to, and whichever
 * payload that native type carries — a size, an element type, a variant type with flags, a custom
 * marshaller's GUID. Which of them apply is decided by the native type alone, and a field that stops
 * applying keeps what it held, as it does in dnSpy: the control reads back only the fields the native
 * type it is on uses, so a value left behind is one the backend never sees.
 */
export const MarshalTypeEditor = ({ workspaceId, value, onChange, options, disabled = false }: MarshalTypeEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const [texts, setTexts] = useState<Partial<Record<TextField, string>>>({})
  // Whatever was typed is a stand-in for the value, so a value that changes underneath it — Restore
  // Settings, or the tab being opened on another row — is what it stops standing in for.
  useEffect(() => { setTexts({}) }, [value])

  const enabled = !disabled && value !== undefined
  const nativeType = value?.nativeType ?? DEFAULT_NATIVE_TYPE
  // What the two element-type combos show when nothing has been picked, which is the sentinel dnSpy
  // puts at the top of the list rather than the first native type.
  const elementType = value?.elementType ?? NATIVE_TYPE.NotInitialized

  /**
   * The array fields hang off one another, and whichever stops applying is dropped: dnSpy's
   * `OnArrayMarshalTypeIsEnabledChanged` writes null into each box whose owner is gone, so a row cannot
   * end up with a parameter number on an element type that is not there.
   */
  const cascade = (next: MarshalTypeDto): MarshalTypeDto => {
    const element = next.elementType ?? NATIVE_TYPE.NotInitialized
    const paramNumber = element === NATIVE_TYPE.NotInitialized ? undefined : next.paramNumber
    const numberOfElements = paramNumber === undefined ? undefined : next.numberOfElements
    const flags = numberOfElements === undefined ? undefined : next.flags
    if (paramNumber === next.paramNumber && numberOfElements === next.numberOfElements && flags === next.flags)
      return next
    return { ...next, paramNumber, numberOfElements, flags }
  }

  const edit = (patch: Partial<MarshalTypeDto>): void => { if (value) onChange(cascade({ ...value, ...patch })) }

  /** A box that holds a number: what is typed stays in the box, and the value follows it when it reads
   * as one. An empty box is the field not being there at all; text that is not a number leaves the
   * value as it was, and is dropped from the box once the user leaves it. */
  const editNumber = (field: TextField, key: keyof MarshalTypeDto, text: string): void => {
    setTexts((current) => ({ ...current, [field]: text }))
    const parsed = parseNumberText(text, COMPRESSED_UINT32_MAX)
    if (parsed.error !== undefined || !value)
      return
    if (parsed.value === undefined) {
      const next = { ...value }
      delete next[key]
      onChange(cascade(next))
      return
    }
    onChange(cascade({ ...value, [key]: parsed.value }))
  }

  const number = (field: TextField, current: number | undefined): string =>
    texts[field] ?? (current === undefined ? '' : formatNumberText(current))

  const dropText = (...fields: TextField[]): void => {
    setTexts((current) => {
      const next = { ...current }
      for (const field of fields)
        delete next[field]
      return next
    })
  }

  const field = (label: string, control: React.ReactNode): React.JSX.Element => (
    <div className="marshal-field">
      <span className="marshal-label">{t(label)}</span>
      {control}
    </div>
  )

  const numberField = (label: string, fieldName: TextField, key: keyof MarshalTypeDto, current: number | undefined, off: boolean): React.JSX.Element =>
    field(label, (
      <input
        aria-label={t(label)}
        value={number(fieldName, current)}
        disabled={!enabled || off}
        onChange={(event) => { editNumber(fieldName, key, event.target.value) }}
        onBlur={() => { dropText(fieldName) }}
      />
    ))

  const combo = (label: string, entries: { name: string, value: number }[], selected: number, onChangeValue: (next: number) => void, off = false): React.JSX.Element =>
    field(label, (
      <select aria-label={t(label)} value={selected} disabled={!enabled || off} onChange={(event) => { onChangeValue(Number(event.target.value)) }}>
        {entries.map((entry) => <option key={entry.value} value={entry.value}>{entry.name}</option>)}
      </select>
    ))

  const variantType = value?.variantType
  const variantKnown = variantType !== undefined && variantType !== VARIANT_TYPE.NotInitialized
  const variantSelected = variantKnown ? variantType & VARIANT_TYPE_MASK : VARIANT_TYPE.NotInitialized
  const flags = variantKnown ? variantFlags(variantType) : 0

  return (
    <div className="marshal-type">
      <label className="options-row">
        <input
          type="checkbox"
          checked={value !== undefined}
          disabled={disabled}
          onChange={(event) => { onChange(event.target.checked ? newMarshalType() : undefined) }}
        />
        {t('Enable')}
      </label>

      {combo('NativeType', NATIVE_TYPES, nativeType, (next) => { edit({ nativeType: next }) }, value === undefined)}

      {value !== undefined && isRawMarshalType(nativeType) && field('Data', (
        <input
          aria-label={t('Data')}
          value={texts.rawData ?? (value.rawData === undefined ? '' : hexOfRawData(value.rawData))}
          disabled={!enabled}
          onChange={(event) => {
            const text = event.target.value
            setTexts((current) => ({ ...current, rawData: text }))
            const parsed = rawDataOfHex(text)
            if (parsed === undefined)
              return
            if (parsed === null)
              edit({ rawData: undefined })
            else
              edit({ rawData: parsed })
          }}
          onBlur={() => { dropText('rawData') }}
        />
      ))}

      {value !== undefined && isFixedSysString(nativeType) && numberField('Size', 'size', 'size', value.size, false)}

      {value !== undefined && isSafeArray(nativeType) && (
        <>
          {combo('VT', VARIANT_TYPES, variantSelected, (next) => {
            edit({ variantType: next === VARIANT_TYPE.NotInitialized ? VARIANT_TYPE.NotInitialized : (next & VARIANT_TYPE_MASK) | flags })
          })}
          <div className="marshal-flags">
            {VARIANT_FLAGS.map((entry) => (
              <label key={entry.name}>
                <input
                  type="checkbox"
                  checked={(flags & entry.value) !== 0}
                  disabled={!enabled || !variantKnown}
                  onChange={(event) => {
                    const next = event.target.checked ? flags | entry.value : flags & ~entry.value
                    edit({ variantType: (variantSelected & VARIANT_TYPE_MASK) | next })
                  }}
                />
                {t(entry.name)}
              </label>
            ))}
          </div>
          {/* dnSpy folds this one into an expander because it is rarely used; it is still the same
              signature editor the other type fields use. */}
          {variantKnown && (
            <div className="marshal-type-sig">
              <TypeSigEditor
                workspaceId={workspaceId}
                value={value.userDefinedSubType ?? null}
                onChange={(next) => { edit({ userDefinedSubType: next ?? undefined }) }}
                options={options}
              />
            </div>
          )}
        </>
      )}

      {value !== undefined && isFixedArray(nativeType) && (
        <>
          {numberField('Size', 'size', 'size', value.size, false)}
          {combo('ElemType', ELEMENT_TYPES, elementType, (next) => { edit({ elementType: next }) }, value.size === undefined)}
        </>
      )}

      {value !== undefined && isArray(nativeType) && (
        <>
          {combo('ElemType', ELEMENT_TYPES, elementType, (next) => {
            // An element type that is not there takes the three boxes with it — the cascade in `edit`
            // drops them from the value, and this drops what was typed into them.
            if (next === NATIVE_TYPE.NotInitialized)
              dropText('paramNumber', 'numberOfElements', 'flags')
            edit({ elementType: next })
          })}
          {numberField('ParamNum', 'paramNumber', 'paramNumber', value.paramNumber, elementType === NATIVE_TYPE.NotInitialized)}
          {numberField('NumElems', 'numberOfElements', 'numberOfElements', value.numberOfElements, value.paramNumber === undefined)}
          {numberField('Flags', 'flags', 'flags', value.flags, value.numberOfElements === undefined)}
        </>
      )}

      {value !== undefined && isCustomMarshaler(nativeType) && (
        <>
          {field('GUID', (
            <input aria-label={t('GUID')} value={value.guid ?? ''} disabled={!enabled} onChange={(event) => { edit({ guid: event.target.value }) }} />
          ))}
          {field('NativeType', (
            <input aria-label={t('NativeType')} value={value.nativeTypeName ?? ''} disabled={!enabled} onChange={(event) => { edit({ nativeTypeName: event.target.value }) }} />
          ))}
          <div className="marshal-type-sig">
            <TypeSigEditor
              workspaceId={workspaceId}
              value={value.customMarshaler ?? null}
              onChange={(next) => { edit({ customMarshaler: next ?? undefined }) }}
              options={options}
            />
          </div>
          {field('Cookie', (
            <input aria-label={t('Cookie')} value={value.cookie ?? ''} disabled={!enabled} onChange={(event) => { edit({ cookie: event.target.value }) }} />
          ))}
        </>
      )}

      {value !== undefined && isInterface(nativeType) && numberField('ParamIndex', 'iidParamIndex', 'iidParamIndex', value.iidParamIndex, false)}
    </div>
  )
}
