import { useRef, useState } from 'react'
import type { ImplMapDto, MethodOptionsDto, MethodSigDto } from '../../../shared/protocol'
import { useLanguage } from '../localization'
import { OptionsShell } from './OptionsShell'
import { CustomAttributeListEditor } from './widgets/CustomAttributeListEditor'
import { DeclSecurityListEditor } from './widgets/DeclSecurityListEditor'
import { GenericParamListEditor } from './widgets/GenericParamListEditor'
import { ImplMapEditor } from './widgets/ImplMapEditor'
import { HAS_THIS_FLAG, MethodSigEditor } from './widgets/MethodSigEditor'
import { MethodOverrideListEditor } from './widgets/MethodOverrideListEditor'
import { ParamDefListEditor } from './widgets/ParamDefListEditor'
import {
  CODE_TYPES,
  IMPL_FLAGS,
  MANAGED_TYPES,
  METHOD_ACCESSES,
  METHOD_ATTRIBUTES,
  METHOD_FLAGS,
  METHOD_IMPL_ATTRIBUTES,
  VTABLE_LAYOUTS,
  codeTypeOf,
  managedTypeOf,
  methodAccessOf,
  methodOptionsDraft,
  methodOptionsDto,
  methodOptionsError,
  vtableLayoutOf,
  withCodeType,
  withManagedType,
  withMethodAccess,
  withVtableLayout,
  type MethodOptionsDraft,
} from './widgets/method-options'
import { hasFlag, withFlag } from './widgets/pinvoke'
import type { TypeSigEditorOptions } from './widgets/TypeSigEditor'

interface MethodOptionsDialogProps {
  workspaceId: string
  /** The model the dialog opens with: what the method holds, or the defaults a new one starts from. */
  value: MethodOptionsDto
  isNew: boolean
  /** Why the backend refused the last attempt to write this model. The window keeps the model, so the
   * reason goes beside it rather than replacing it. */
  failure?: string
  onAccept(options: MethodOptionsDto): void
  onCancel(): void
}

/** A signature with nothing in it yet, for a method the file gives none — dnSpy's creator opens empty
 * too, and its return type being unset is what leaves OK disabled until one is picked. */
const emptyMethodSig = (): MethodSigDto => ({
  callingConvention: 0,
  returnType: { kind: 'empty' },
  parameters: [],
})

/**
 * dnSpy's `MethodOptionsDlg`: the eight pages of the method editor on one window, which is the same
 * window for creating and editing — only the title and the model it starts from differ.
 *
 * Two of the fields are not written where they look like they are. The method's `PinvokeImpl` bit is the
 * ImplMap page's Enable box: turning the box on turns the bit on, and there is no checkbox for either.
 * And the `HasSecurity` bit is settled from the security rows and attributes when the model is handed
 * over, so that a row added and removed again leaves the method as it was.
 */
export const MethodOptionsDialog = ({ workspaceId, value, isNew, failure, onAccept, onCancel }: MethodOptionsDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<MethodOptionsDraft>(() => methodOptionsDraft(value))
  // The entry point and flags of a P/Invoke row, kept while its Enable box is off: dnSpy's control only
  // greys its boxes out, so turning the box back on shows what was there. This draft has nowhere to keep
  // a disabled row, so the last value lives beside it.
  const lastImplMap = useRef<ImplMapDto | undefined>(undefined)
  const error = methodOptionsError(draft)

  /**
   * What the signature editors may hold, which is dnSpy's `TypeSigCreatorOptions` for this dialog: the
   * owner type's generic parameters are only usable when it has any, and the method's own when it has
   * any — or always for one being created, whose Generic Params page is about to collect them. dnSpy
   * settles the method's flag once, from the method as it was opened; here it follows the page, which
   * only ever offers MVar where there is a parameter of the method to name.
   */
  const signatureOptions: TypeSigEditorOptions = {
    canAddGenericTypeVar: draft.ownerGenericParameterCount > 0,
    canAddGenericMethodVar: isNew || draft.genericParameters.length > 0,
    canAddFnPtr: true,
    isLocal: false,
  }

  const edit = (patch: Partial<MethodOptionsDraft>): void => { setDraft({ ...draft, ...patch }) }

  /** The two flag words are the whole of the impl-attributes and attributes boxes: the combos hold a
   * masked part of each, and a checkbox writes its own bit into the rest. */
  const setImplAttributes = (implAttributes: number): void => { edit({ implAttributes }) }

  const setAttributes = (attributes: number): void => {
    const next = { ...draft, attributes }
    // dnSpy links the method's static bit to its signature's HasThis flag, both ways round: a method with
    // no `this` is static, and the checkbox and the flag each write the other whenever they change.
    if (draft.methodSig && hasFlag(attributes, METHOD_ATTRIBUTES.Static) !== hasFlag(draft.attributes, METHOD_ATTRIBUTES.Static))
      next.methodSig = { ...draft.methodSig, callingConvention: withFlag(draft.methodSig.callingConvention, HAS_THIS_FLAG, !hasFlag(attributes, METHOD_ATTRIBUTES.Static)) }
    setDraft(next)
  }

  const setMethodSig = (methodSig: MethodSigDto): void => {
    edit({
      methodSig,
      attributes: withFlag(draft.attributes, METHOD_ATTRIBUTES.Static, !hasFlag(methodSig.callingConvention, HAS_THIS_FLAG)),
    })
  }

  const setImplMap = (implMap: ImplMapDto | undefined): void => {
    // What the row held before this change is kept as it goes, so that turning the box off and on again
    // finds the entry point still there rather than the empty row the control hands back.
    if (draft.implMap !== undefined)
      lastImplMap.current = draft.implMap
    const next = implMap !== undefined && draft.implMap === undefined ? lastImplMap.current ?? implMap : implMap
    edit({ implMap: next, attributes: withFlag(draft.attributes, METHOD_ATTRIBUTES.PinvokeImpl, next !== undefined) })
  }

  const flagGroup = (legend: string | undefined, flags: { label: string, flag: number }[], word: number, onChange: (word: number) => void): React.JSX.Element => (
    <fieldset className="ca-group">
      {legend && <legend>{t(legend)}</legend>}
      <div className="method-options-flags">
        {flags.map((entry) => (
          <label className="options-row" key={entry.label}>
            <input
              type="checkbox"
              checked={hasFlag(word, entry.flag)}
              onChange={(event) => { onChange(withFlag(word, entry.flag, event.target.checked)) }}
            />
            {entry.label}
          </label>
        ))}
      </div>
    </fieldset>
  )

  const combo = (label: string, entries: { label: string, value: number }[], value: number, onChange: (value: number) => void): React.JSX.Element => (
    <label className="method-options-combo">
      <span className="options-row-label">{t(label)}</span>
      <select aria-label={t(label)} value={value} onChange={(event) => { onChange(Number(event.target.value)) }}>
        {entries.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
    </label>
  )

  return (
    <OptionsShell
      title={isNew ? 'Create Method' : 'Edit Method'}
      className="method-options"
      tabs={[
        {
          label: 'Main',
          content: (
            <div className="method-options-main">
              <label className="method-options-name">
                <span className="options-row-label">{t('Name')}</span>
                <input aria-label={t('Name')} value={draft.name} onChange={(event) => { edit({ name: event.target.value }) }} />
              </label>

              {/* The header is a literal in the XAML, so it is not run through the translator, and the
                  nine captions are the enum's own names. */}
              {flagGroup(undefined, IMPL_FLAGS, draft.implAttributes, setImplAttributes)}
              {flagGroup('Flags', METHOD_FLAGS, draft.attributes, setAttributes)}

              <div className="method-options-combos">
                {combo('CodeType', CODE_TYPES, codeTypeOf(draft.implAttributes), (codeType) => { setImplAttributes(withCodeType(draft.implAttributes, codeType)) })}
                {combo('ManagedType', MANAGED_TYPES, managedTypeOf(draft.implAttributes), (managedType) => { setImplAttributes(withManagedType(draft.implAttributes, managedType)) })}
                {combo('Access', METHOD_ACCESSES, methodAccessOf(draft.attributes), (access) => { setAttributes(withMethodAccess(draft.attributes, access)) })}
                {combo('VtableLayout', VTABLE_LAYOUTS, vtableLayoutOf(draft.attributes), (layout) => { setAttributes(withVtableLayout(draft.attributes, layout)) })}
              </div>
            </div>
          ),
        },
        {
          label: 'Signature',
          content: (
            <MethodSigEditor
              workspaceId={workspaceId}
              value={draft.methodSig ?? emptyMethodSig()}
              onChange={setMethodSig}
              options={signatureOptions}
            />
          ),
        },
        {
          label: 'Params',
          content: (
            <ParamDefListEditor
              workspaceId={workspaceId}
              items={draft.paramDefs}
              onChange={(paramDefs) => { edit({ paramDefs }) }}
              options={signatureOptions}
            />
          ),
        },
        {
          label: 'Generic Params',
          content: (
            <GenericParamListEditor
              workspaceId={workspaceId}
              items={draft.genericParameters}
              onChange={(genericParameters) => { edit({ genericParameters }) }}
              options={signatureOptions}
            />
          ),
        },
        {
          label: 'ImplMap',
          content: <ImplMapEditor value={draft.implMap} onChange={setImplMap} />,
        },
        {
          label: 'Overrides',
          content: (
            <MethodOverrideListEditor
              workspaceId={workspaceId}
              items={draft.overrides}
              onChange={(overrides) => { edit({ overrides }) }}
            />
          ),
        },
        {
          label: 'Custom Attrs',
          content: (
            <CustomAttributeListEditor
              workspaceId={workspaceId}
              items={draft.customAttributes}
              onChange={(customAttributes) => { edit({ customAttributes }) }}
            />
          ),
        },
        {
          label: 'Sec Decls',
          content: (
            <DeclSecurityListEditor
              workspaceId={workspaceId}
              items={draft.declSecurities}
              onChange={(declSecurities) => { edit({ declSecurities }) }}
            />
          ),
        },
      ]}
      invalid={error !== undefined}
      // The page's own complaint wins while there is one: it is what is holding OK down right now, and
      // the refused write it followed is already out of date.
      error={error === undefined ? failure : t(error.template, error.args)}
      onReset={() => { lastImplMap.current = undefined; setDraft(methodOptionsDraft(value)) }}
      onAccept={() => { onAccept(methodOptionsDto(draft)) }}
      onClose={onCancel}
    />
  )
}
