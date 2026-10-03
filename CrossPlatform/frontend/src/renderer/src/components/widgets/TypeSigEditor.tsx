import { useState } from 'react'
import type { MethodSigDto, TreeNode, TypeRefDto, TypeSigDto } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import { TypePickerDialog } from '../TypePickerDialog'
import { MethodSigEditor } from './MethodSigEditor'
import { describeTypeRef, describeTypeSig, referenceOf } from './type-sig-text'

/**
 * What a signature being edited can hold, mirroring dnSpy's `TypeSigCreatorOptions` together with the
 * creator's own `CanAddFnPtr`. Every one of them only takes a button away: the shape a caller does not
 * allow is one the signature could not legally use anyway.
 */
export interface TypeSigEditorOptions {
  /** Whether the enclosing type's generic parameters (`Var`) may be used. */
  canAddGenericTypeVar?: boolean
  /** Whether the enclosing method's generic parameters (`MVar`) may be used. */
  canAddGenericMethodVar?: boolean
  /** Whether a function pointer may be used — dnSpy offers one everywhere but a parameter type. */
  canAddFnPtr?: boolean
  /** Whether `Pinned` is offered, which only a local variable can carry. */
  isLocal?: boolean
}

interface TypeSigEditorProps {
  workspaceId: string
  /** The signature, or null while nothing has been added to it yet. */
  value: TypeSigDto | null
  onChange(value: TypeSigDto | null): void
  options?: TypeSigEditorOptions
  disabled?: boolean
}

/** Which button opened the type picker, since four of them do. */
type PickerUse = 'type' | 'genericInst' | 'cmodreqd' | 'cmodopt'

/** dnlib's compressed ranges, which is what a rank, a size or a lower bound has to fit in. */
const UINT32_MIN = 0
const UINT32_MAX = 0x1FFFFFFF
const INT32_MIN = -0x10000000
const INT32_MAX = 0x0FFFFFFF

function parseUint(text: string): number | undefined {
  const value = /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN
  return Number.isInteger(value) && value >= UINT32_MIN && value <= UINT32_MAX ? value : undefined
}

function parseUintList(text: string): number[] | undefined {
  const parts = splitList(text)
  const values = parts?.map(parseUint)
  return values && values.every((value) => value !== undefined) ? values as number[] : undefined
}

function parseIntList(text: string): number[] | undefined {
  const parts = splitList(text)
  const values = parts?.map((part) => /^-?\d+$/.test(part) ? Number(part) : Number.NaN)
  return values && values.every((value) => Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX) ? values as number[] : undefined
}

/** An empty field is empty rather than invalid — dnSpy takes an unset sizes or lower-bounds list. */
function splitList(text: string): string[] | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0)
    return []
  const parts = trimmed.split(',').map((part) => part.trim())
  return parts.some((part) => part.length === 0) ? undefined : parts
}

/** The signature a function pointer starts out with, which is the one dnSpy's method-signature dialog
 * opens with: no calling convention of its own, returning void, and taking nothing. */
const emptyFunctionPointer = (): MethodSigDto => ({
  callingConvention: 0,
  returnType: { kind: 'type', type: { scope: '', namespace: 'System', name: 'Void' } },
  parameters: [],
})

/**
 * The type-signature editor: dnSpy's `TypeSigCreatorControl`. A signature is built by picking a type and
 * then wrapping it — in a pointer, an array, a generic instance — so the buttons it offers depend on
 * whether anything has been added yet, and the value that is being edited is exactly the tree those
 * buttons build.
 *
 * Two things are edited in place where dnSpy opens a dialog: a generic instance's type arguments, and a
 * function pointer's signature. Both are the same controls the dialogs would have shown, and both recurse
 * into this one, which is why this file and the method-signature one import each other.
 */
export const TypeSigEditor = ({ workspaceId, value, onChange, options = {}, disabled = false }: TypeSigEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const [picker, setPicker] = useState<PickerUse>()
  const [genericNumber, setGenericNumber] = useState('0')
  const [rank, setRank] = useState('2')
  const [sizes, setSizes] = useState('')
  const [lowerBounds, setLowerBounds] = useState('')
  const [warning, setWarning] = useState<string>()
  const notSet = t('(not set)')

  // dnSpy's CanAddLeafTypeSig / CanAddNonLeafTypeSig: a leaf can only start a signature, a wrapper can
  // only wrap one, and a pinned signature cannot be wrapped at all.
  const canAddLeaf = !disabled && value === null
  const canAddNonLeaf = !disabled && value !== null && value.kind !== 'pinned'
  const genericVariable = parseUint(genericNumber)
  const arrayRank = parseUint(rank)
  const arraySizes = parseUintList(sizes)
  const arrayBounds = parseIntList(lowerBounds)

  const addType = (node: TreeNode, trail: TreeNode[]): void => {
    onChange({ kind: 'type', type: referenceOf(node, trail) })
  }

  const addGenericInstance = async (node: TreeNode, trail: TreeNode[]): Promise<void> => {
    const reference = referenceOf(node, trail)
    try {
      // A generic instance takes one argument per parameter the type declares, and the type is what
      // knows how many that is. dnSpy asks the same question of the resolved definition.
      const response = await window.dnSpy.getNodeOptions(workspaceId, 'type', { nodeId: node.id })
      const count = response.type?.genericParameters.length ?? 0
      if (count === 0) {
        setWarning(t('{name} is not a generic type', { name: describeTypeRef(reference) }))
        return
      }
      setWarning(undefined)
      onChange({ kind: 'genericInst', type: reference, arguments: Array.from({ length: count }, () => ({ kind: 'empty' } as TypeSigDto)) })
    }
    catch (cause) {
      setWarning(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const pick = (node: TreeNode, trail: TreeNode[], use: PickerUse): void => {
    setPicker(undefined)
    if (use === 'type') {
      addType(node, trail)
      return
    }
    if (use === 'cmodreqd' || use === 'cmodopt') {
      // The modifier is a type of its own, picked the same way, and the signature so far is what it
      // modifies — dnlib's CModReqdSig/CModOptSig take exactly that pair.
      if (value !== null)
        onChange({ kind: use, modifier: { kind: 'type', type: referenceOf(node, trail) }, element: value })
      return
    }
    void addGenericInstance(node, trail)
  }

  const addGenericVariable = (kind: 'genericvar' | 'genericmvar'): void => {
    if (genericVariable !== undefined)
      onChange({ kind, genericParameterNumber: genericVariable })
  }

  const addArray = (): void => {
    if (value !== null && arrayRank !== undefined && arraySizes !== undefined && arrayBounds !== undefined)
      onChange({ kind: 'array', element: value, rank: arrayRank, sizes: arraySizes, lowerBounds: arrayBounds })
  }

  /** dnSpy's RemoveLastTypeSig: dropping the outermost shape, which leaves what it was built on. */
  const removeLast = (): void => {
    if (value === null)
      return
    if (value.kind === 'genericInst' && value.type)
      onChange({ kind: 'type', type: value.type, valueType: value.valueType })
    else
      onChange(value.element ?? null)
  }

  return (
    <div className="typesig-editor">
      {value !== null && <div className="typesig-preview">{describeTypeSig(value, notSet)}</div>}
      <div className="typesig-buttons">
        <button type="button" disabled={disabled || value === null} title={t('Clear type')} onClick={() => { onChange(null) }}>{t('Clear')}</button>
        <button type="button" disabled={disabled || value === null} title={t('Remove last added type')} onClick={removeLast}>{t('Remove')}</button>
      </div>
      {value === null
        ? (
          <div className="typesig-buttons">
            <button type="button" disabled={!canAddLeaf} title={t('Add a type')} onClick={() => { setPicker('type') }}>{t('Type')}</button>
            <button type="button" disabled={!canAddLeaf || !options.canAddGenericTypeVar} title={t('Add a type generic variable')} onClick={() => { addGenericVariable('genericvar') }}>{t('Var')}</button>
            <button type="button" disabled={!canAddLeaf || !options.canAddGenericMethodVar} title={t('Add a method generic variable')} onClick={() => { addGenericVariable('genericmvar') }}>{t('MVar')}</button>
            <label className="typesig-number" title={t('Type/method generic variable number')}>
              {t('#')}
              <input value={genericNumber} disabled={!canAddLeaf || !(options.canAddGenericTypeVar || options.canAddGenericMethodVar)} onChange={(event) => { setGenericNumber(event.target.value) }} />
            </label>
            <button type="button" disabled={!canAddLeaf} title={t('Add a generic instance type')} onClick={() => { setPicker('genericInst') }}>{t('GenericInst')}</button>
            <button type="button" disabled={!canAddLeaf || options.canAddFnPtr === false} title={t('Add a function pointer')} onClick={() => { onChange({ kind: 'fnptr', functionPointer: emptyFunctionPointer() }) }}>{t('FnPtr')}</button>
          </div>
          )
        : (
          <>
            <div className="typesig-buttons">
              <button type="button" disabled={!canAddNonLeaf} title={t('Convert type to a pointer')} onClick={() => { onChange({ kind: 'ptr', element: value }) }}>{t('Pointer')}</button>
              <button type="button" disabled={!canAddNonLeaf} title={t('Convert type to a by-reference')} onClick={() => { onChange({ kind: 'byref', element: value }) }}>{t('ByRef')}</button>
              <button type="button" disabled={!canAddNonLeaf} title={t('Convert type to a single-dimension, zero lower-bound array')} onClick={() => { onChange({ kind: 'szarray', element: value }) }}>{t('SZ Array')}</button>
              <button type="button" disabled={!canAddNonLeaf} title={t('Add a required C modifier')} onClick={() => { setPicker('cmodreqd') }}>{t('CModReqd')}</button>
              <button type="button" disabled={!canAddNonLeaf} title={t('Add an optional C modifier')} onClick={() => { setPicker('cmodopt') }}>{t('CModOpt')}</button>
              <button type="button" disabled={!canAddNonLeaf || !options.isLocal} title={t('Turn it into a pinned variable')} onClick={() => { onChange({ kind: 'pinned', element: value }) }}>{t('Pinned')}</button>
            </div>
            <fieldset className="typesig-fieldset">
              <legend>{t('Multidimensional Array')}</legend>
              <div className="typesig-buttons">
                <button type="button" disabled={!canAddNonLeaf || arrayRank === undefined || arraySizes === undefined || arrayBounds === undefined} title={t('Convert type to a multidimensional array')} onClick={addArray}>{t('Array')}</button>
                <label className="typesig-number">{t('Rank')}<input value={rank} disabled={disabled} onChange={(event) => { setRank(event.target.value) }} /></label>
              </div>
              <div className="typesig-buttons">
                <label className="typesig-number" title={t('Comma separated list of array sizes (unsigned integers)')}>{t('Sizes')}<input value={sizes} disabled={disabled} onChange={(event) => { setSizes(event.target.value) }} /></label>
                <label className="typesig-number" title={t('Comma separated list of array lower bounds (signed integers)')}>{t('Lower Bounds')}<input value={lowerBounds} disabled={disabled} onChange={(event) => { setLowerBounds(event.target.value) }} /></label>
              </div>
            </fieldset>
            {value.kind === 'genericInst' && (value.arguments ?? []).map((argument, index) => (
              <div className="typesig-argument" key={index}>
                <span className="typesig-argument-label">{t('Type argument {number}', { number: index + 1 })}</span>
                <TypeSigEditor
                  workspaceId={workspaceId}
                  value={argument.kind === 'empty' ? null : argument}
                  onChange={(next) => {
                    onChange({ ...value, arguments: (value.arguments ?? []).map((current, position) => position === index ? (next ?? { kind: 'empty' } as TypeSigDto) : current) })
                  }}
                  options={options}
                  disabled={disabled}
                />
              </div>
            ))}
            {value.kind === 'fnptr' && (
              <div className="typesig-argument">
                <MethodSigEditor
                  workspaceId={workspaceId}
                  value={value.functionPointer ?? emptyFunctionPointer()}
                  onChange={(next) => { onChange({ kind: 'fnptr', functionPointer: next }) }}
                  options={options}
                  canHaveSentinel
                  disabled={disabled}
                />
              </div>
            )}
          </>
          )}
      {warning && <div className="typesig-warning">{warning}</div>}
      {picker && (
        <TypePickerDialog
          workspaceId={workspaceId}
          mode="type"
          title={picker === 'genericInst' ? t('Pick a Generic Type') : undefined}
          onPick={(node, trail) => { pick(node, trail, picker) }}
          onClose={() => { setPicker(undefined) }}
        />
      )}
    </div>
  )
}
