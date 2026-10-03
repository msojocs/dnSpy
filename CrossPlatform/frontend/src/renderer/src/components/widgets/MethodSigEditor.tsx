import { useState } from 'react'
import type { MethodSigDto } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import { TypeSigEditor, type TypeSigEditorOptions } from './TypeSigEditor'
import { TypeSigListEditor } from './TypeSigListEditor'
import { describeMethodSig } from './type-sig-text'

// dnlib's `CallingConvention`: the low nibble is the convention itself and bits 4-6 are the flags, which
// is why the combo and the checkboxes all write into the one value.
const CALLING_CONVENTION_MASK = 0x0F
const GENERIC_FLAG = 0x10
const HAS_THIS_FLAG = 0x20
const EXPLICIT_THIS_FLAG = 0x40

/** The conventions the combo offers, which is dnSpy's `MethodCallingConv` list in its own order. */
const CALLING_CONVENTIONS: { value: number, name: string }[] = [
  { value: 0, name: 'Default' },
  { value: 1, name: 'C' },
  { value: 2, name: 'StdCall' },
  { value: 3, name: 'ThisCall' },
  { value: 4, name: 'FastCall' },
  { value: 5, name: 'VarArg' },
  { value: 9, name: 'Unmanaged' },
  { value: 11, name: 'NativeVarArg' },
]

interface MethodSigEditorProps {
  workspaceId: string
  value: MethodSigDto
  onChange(value: MethodSigDto): void
  options?: TypeSigEditorOptions
  /** Whether the signature may hold parameters after a sentinel. A method of a type never can; a call
   * target, which is what a function pointer names, can. */
  canHaveSentinel?: boolean
  disabled?: boolean
}

/**
 * The method-signature editor: dnSpy's `MethodSigCreatorControl`. Its calling convention is one number
 * carrying both the convention and the flags — Generic, HasThis, ExplicitThis — so the combo writes the
 * low nibble and the checkboxes write the bits, and the generic parameter count is what sets the Generic
 * flag rather than the other way round.
 *
 * The return type is edited here rather than in a dialog of its own, which is the one place this port
 * differs from dnSpy: it opens a `TypeSigCreator` dialog for it, and this shows that control inline.
 */
export const MethodSigEditor = ({ workspaceId, value, onChange, options, canHaveSentinel = false, disabled = false }: MethodSigEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const [genericCount, setGenericCount] = useState(String(value.genericParameterCount ?? 0))
  const notSet = t('(not set)')

  const setFlag = (flag: number, on: boolean): void => {
    onChange({ ...value, callingConvention: on ? value.callingConvention | flag : value.callingConvention & ~flag })
  }

  const setGenericParameterCount = (text: string): void => {
    setGenericCount(text)
    const count = /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined
    if (count === undefined)
      return
    // dnSpy's GenericParameterCount callback: a signature is generic exactly when it has parameters,
    // so the count is what sets the flag, and an unreadable count leaves both as they were.
    onChange({
      ...value,
      genericParameterCount: count,
      callingConvention: count === 0 ? value.callingConvention & ~GENERIC_FLAG : value.callingConvention | GENERIC_FLAG,
    })
  }

  return (
    <div className="methodsig-editor">
      <div className="typesig-preview">{describeMethodSig(value, notSet)}</div>
      <fieldset className="methodsig-flags">
        <legend>{t('Flags')}</legend>
        <label>
          <input type="checkbox" checked={(value.callingConvention & HAS_THIS_FLAG) !== 0} disabled={disabled} onChange={(event) => { setFlag(HAS_THIS_FLAG, event.target.checked) }} />
          HasThis
        </label>
        <label>
          <input type="checkbox" checked={(value.callingConvention & EXPLICIT_THIS_FLAG) !== 0} disabled={disabled} onChange={(event) => { setFlag(EXPLICIT_THIS_FLAG, event.target.checked) }} />
          ExplicitThis
        </label>
        <label>
          {t('Calling Conv')}
          <select
            value={value.callingConvention & CALLING_CONVENTION_MASK}
            disabled={disabled}
            onChange={(event) => { onChange({ ...value, callingConvention: (value.callingConvention & ~CALLING_CONVENTION_MASK) | Number(event.target.value) }) }}
          >
            {CALLING_CONVENTIONS.map((convention) => <option key={convention.value} value={convention.value}>{convention.name}</option>)}
          </select>
        </label>
        <label>
          {t('# Generics')}
          <input value={genericCount} disabled={disabled} onChange={(event) => { setGenericParameterCount(event.target.value) }} />
        </label>
      </fieldset>
      <div className="methodsig-return">
        <span className="methodsig-return-label">{t('Return Type')}</span>
        <TypeSigEditor
          workspaceId={workspaceId}
          value={value.returnType.kind === 'empty' ? null : value.returnType}
          onChange={(next) => { onChange({ ...value, returnType: next ?? { kind: 'empty' } }) }}
          options={options}
          disabled={disabled}
        />
      </div>
      <details className="methodsig-section" open>
        <summary>{t('Method Parameter Types')}</summary>
        <TypeSigListEditor
          workspaceId={workspaceId}
          values={value.parameters}
          onChange={(parameters) => { onChange({ ...value, parameters }) }}
          options={{ ...options, canAddFnPtr: false }}
          disabled={disabled}
        />
      </details>
      {canHaveSentinel && (
        <details className="methodsig-section">
          <summary>{t('Method VarArg Parameter Types')}</summary>
          <TypeSigListEditor
            workspaceId={workspaceId}
            values={value.varArgParameters ?? []}
            onChange={(varArgParameters) => { onChange({ ...value, varArgParameters }) }}
            options={{ ...options, canAddFnPtr: false }}
            disabled={disabled}
          />
        </details>
      )}
    </div>
  )
}
