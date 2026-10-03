import { useState } from 'react'
import type { CaArgumentDto, TreeNode, TypeSigDto } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import { TypePickerDialog } from '../TypePickerDialog'
import {
  CA_ENUM, CA_NULL, CA_OBJECT, CA_TYPE,
  caArgumentError, caArgumentText, caArrayElementKind, caArrayIsNull, caArrayIsPicked, caArrayText,
  caBoxedArgument, caDefaultArgument, caKindList, caKindOf, caScalar, caSetArrayNull, caSetArrayText,
  caSetBoxedArgument, caSetText,
} from './ca-value'
import { describeTypeSig, NOT_SET, referenceOf } from './type-sig-text'

/** Which of the two pickers a value has open, if either. */
type PickerUse = 'enum' | 'type'

interface CaValueEditorProps {
  workspaceId: string
  /** The kind the value is being edited as, which the caller has already worked out. */
  kind: string
  value: CaArgumentDto
  onChange(value: CaArgumentDto): void
  /** Whether a value that is itself an object is offered. The editor nested inside one cannot hold
   * another, or the two would recurse without end. */
  allowObject?: boolean
  disabled?: boolean
}

/**
 * The box a kind's value goes in — dnSpy's `ConstantTypeControl` below its combo. It is split out from
 * the combo because a custom attribute's named arguments put their own combo above it: their kind is
 * picked in the row rather than in the value editor, and the two would otherwise both show one.
 *
 * Two of the kinds are picked rather than typed, and both use the type picker: an enum's type, which is
 * what tells the backend how wide the value is, and a `System.Type` value, which is the reference
 * itself. An array is edited as the elements it holds — a comma-separated box for the kinds that are
 * text, which is dnSpy's `ParseList`, and a row per element for the kinds that have to be picked.
 */
export const CaValueEditor = ({ workspaceId, kind, value, onChange, allowObject = true, disabled = false }: CaValueEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const [picker, setPicker] = useState<PickerUse>()
  const scalar = caScalar(kind)
  const elementKind = caArrayElementKind(kind)

  const pick = (node: TreeNode, trail: TreeNode[]): void => {
    setPicker(undefined)
    const reference = referenceOf(node, trail)
    if (picker === 'enum') {
      // The value keeps whatever it held: an enum is usually switched to a wider or a narrower one, and
      // the number that was there is still the number meant.
      onChange({ type: { kind: 'type', type: reference }, value: value.value })
      return
    }
    onChange({ type: value.type, value: { kind: 'type', referencedType: { kind: 'type', type: reference } } })
  }

  const textBox = (
    <input
      aria-label={t('Value')}
      value={caArgumentText(value)}
      disabled={disabled}
      onChange={(event) => { onChange(caSetText(kind, value, event.target.value)) }}
    />
  )

  const pickedArray = (elementKind: string): React.JSX.Element => {
    const elements = value.value.kind === 'array' ? value.value.elements ?? [] : []
    const replace = (index: number, element: CaArgumentDto): void => {
      onChange({ type: value.type, value: { kind: 'array', elements: elements.map((current, at) => at === index ? element : current) } })
    }
    return (
      <div className="ca-array">
        {elements.map((element, index) => (
          <div key={index} className="ca-array-row">
            <CaArgumentEditor workspaceId={workspaceId} value={element} onChange={(next) => { replace(index, next) }} allowNull={false} allowObject={false} disabled={disabled} />
            <button type="button" title={t('Remove')} aria-label={t('Remove')} disabled={disabled} onClick={() => { onChange({ type: value.type, value: { kind: 'array', elements: elements.filter((_, at) => at !== index) } }) }}>×</button>
          </div>
        ))}
        <button type="button" disabled={disabled} onClick={() => { onChange({ type: value.type, value: { kind: 'array', elements: [...elements, caDefaultArgument(elementKind)] } }) }}>{t('Add')}</button>
      </div>
    )
  }

  const arrayValue = (elementKind: string): React.JSX.Element => {
    const isNull = caArrayIsNull(value)
    if (caArrayIsPicked(elementKind))
      return isNull ? <span className="ca-argument-null">null</span> : pickedArray(elementKind)
    return (
      <div className="ca-array-text">
        {/* dnSpy tells a null array from an empty one with this box, and an empty box is the empty one;
            the box carries no caption there, so this one carries none either. */}
        <input
          type="checkbox"
          aria-label={t('null')}
          title={t('null')}
          checked={isNull}
          disabled={disabled}
          onChange={(event) => { onChange(caSetArrayNull(value, event.target.checked)) }}
        />
        {!isNull && (
          <input
            aria-label={t('Value')}
            value={caArrayText(value)}
            disabled={disabled}
            onChange={(event) => { onChange(caSetArrayText(kind, value, event.target.value)) }}
          />
        )}
      </div>
    )
  }

  const objectValue = (): React.JSX.Element => {
    const inner = caBoxedArgument(value)
    if (!inner)
      return <span className="ca-argument-null">{t(NOT_SET)}</span>
    return (
      <CaArgumentEditor
        workspaceId={workspaceId}
        value={inner}
        onChange={(next) => { onChange(caSetBoxedArgument(value, next)) }}
        allowNull={false}
        allowObject={false}
        disabled={disabled}
      />
    )
  }

  if (kind === CA_NULL)
    return <span className="ca-argument-null">null</span>
  if (elementKind !== undefined)
    return arrayValue(elementKind)
  if (kind === CA_OBJECT)
    return objectValue()
  if (kind === CA_ENUM) {
    const enumSig: TypeSigDto | undefined = value.type.kind === 'type' && value.type.type ? value.type : undefined
    return (
      <>
        {textBox}
        <button type="button" title={t('Pick an Enum Type')} aria-label={t('Pick an Enum Type')} disabled={disabled} onClick={() => { setPicker('enum') }}>...</button>
        <span className="ca-argument-type">{enumSig ? describeTypeSig(enumSig) : t(NOT_SET)}</span>
        {picker && <TypePickerDialog workspaceId={workspaceId} mode="type" onPick={pick} onClose={() => { setPicker(undefined) }} />}
      </>
    )
  }
  if (kind === CA_TYPE) {
    const referenced = value.value.kind === 'type' ? value.value.referencedType : undefined
    return (
      <>
        <input readOnly aria-label={t('Value')} value={referenced ? describeTypeSig(referenced) : ''} />
        <button type="button" title={t('Pick a Type')} aria-label={t('Pick a Type')} disabled={disabled} onClick={() => { setPicker('type') }}>...</button>
        {picker && <TypePickerDialog workspaceId={workspaceId} mode="type" onPick={pick} onClose={() => { setPicker(undefined) }} />}
      </>
    )
  }
  // Every remaining kind is a scalar, and the only thing that differs between them is how the text is
  // read back — which is what `caSetText` decides from the kind.
  return scalar === undefined ? <span className="ca-argument-null">{t(NOT_SET)}</span> : textBox
}

interface CaArgumentEditorProps {
  workspaceId: string
  value: CaArgumentDto
  onChange(value: CaArgumentDto): void
  /** Whether the kind that stands for "no value" is offered. A constructor argument cannot be null —
   * the constructor already decided the type — and dnSpy's combo reflects that. */
  allowNull?: boolean
  /** Whether a value that is itself an object is offered. See `CaValueEditor`. */
  allowObject?: boolean
  disabled?: boolean
}

/**
 * One custom attribute argument: dnSpy's `CAArgumentVM`, which is a combo of the kinds a value can be
 * and the box for the kind that is selected. The combo is the same list dnSpy offers, in the same
 * order, and changing it starts the value over at the new kind's default — dnSpy rebuilds it through
 * `CreateCAArgument` the same way.
 */
export const CaArgumentEditor = ({ workspaceId, value, onChange, allowNull = true, allowObject = true, disabled = false }: CaArgumentEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const kind = caKindOf(value, allowNull)
  const kinds = caKindList(allowNull).filter((id) => allowObject || (id !== CA_OBJECT && id !== `${CA_OBJECT}[]`))
  const error = caArgumentError(value)
  return (
    <div className="ca-argument">
      <div className="ca-argument-row">
        <select aria-label={t('Value type')} value={kind} disabled={disabled} onChange={(event) => { onChange(caDefaultArgument(event.target.value, value)) }}>
          {/* A kind the argument already holds stays in the list even when this editor would not offer
              it, so that the combo shows what the value is rather than an empty selection. */}
          {(kinds.includes(kind) ? kinds : [kind, ...kinds]).map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <CaValueEditor workspaceId={workspaceId} kind={kind} value={value} onChange={onChange} allowObject={allowObject} disabled={disabled} />
      </div>
      {error && <div className="options-error">{t(error.template, error.args)}</div>}
    </div>
  )
}
