import { useRef, useState } from 'react'
import type { FieldOptionsDto, ImplMapDto } from '../../../shared/protocol'
import { useLanguage } from '../localization'
import { OptionsShell } from './OptionsShell'
import { ConstantEditor } from './widgets/ConstantEditor'
import { CustomAttributeListEditor } from './widgets/CustomAttributeListEditor'
import { hasFieldFlag, fieldAccessOf, FIELD_ACCESSES, FIELD_FLAGS, fieldOptionsDraft, fieldOptionsDto, fieldOptionsError, withFieldAccess, withFieldFlag, type FieldOptionsDraft } from './widgets/field-options'
import { ImplMapEditor } from './widgets/ImplMapEditor'
import { MarshalTypeEditor } from './widgets/MarshalTypeEditor'
import { TypeSigEditor, type TypeSigEditorOptions } from './widgets/TypeSigEditor'

interface FieldOptionsDialogProps {
  workspaceId: string
  /** The model the dialog opens with: what the field holds, or the defaults a new one starts from. */
  value: FieldOptionsDto
  isNew: boolean
  /** Why the backend refused the last attempt to write this model. The window keeps the model, so the
   * reason goes beside it rather than replacing it. */
  failure?: string
  onAccept(options: FieldOptionsDto): void
  onCancel(): void
}

/**
 * dnSpy's `FieldOptionsDlg`: the five pages of the field editor on one window, which is the same window
 * for creating and editing — only the title and the model it starts with differ.
 *
 * Three of the attribute bits are not boxes here. `HasFieldMarshal` and `HasDefault` follow the values
 * they belong to, and `PinvokeImpl` is the ImplMap page's Enable box, so a row added and removed again
 * leaves the word as it was. `HasFieldRVA` is a box of its own, because an initial value of no bytes is
 * still an initial value: what says the field has one cannot be whether the box is empty.
 */
export const FieldOptionsDialog = ({ workspaceId, value, isNew, failure, onAccept, onCancel }: FieldOptionsDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<FieldOptionsDraft>(() => fieldOptionsDraft(value))
  // The entry point and flags of a P/Invoke row, kept while its Enable box is off: dnSpy's control only
  // greys its boxes out, so turning the box back on shows what was there. This draft has nowhere to keep
  // a disabled row, so the last value lives beside it.
  const lastImplMap = useRef<ImplMapDto | undefined>(undefined)
  const error = fieldOptionsError(draft)

  /**
   * What the type editor may hold, which is dnSpy's `TypeSigCreatorOptions` for this dialog: the owner
   * type's generic parameters when it has any, and no function pointers — a field can never be one.
   */
  const signatureOptions: TypeSigEditorOptions = {
    canAddGenericTypeVar: (value.ownerGenericParameterCount ?? 0) > 0,
    canAddGenericMethodVar: false,
    canAddFnPtr: false,
    isLocal: false,
  }

  const edit = (patch: Partial<FieldOptionsDraft>): void => { setDraft({ ...draft, ...patch }) }

  const setImplMap = (implMap: ImplMapDto | undefined): void => {
    // What the row held before this change is kept as it goes, so that turning the box off and on again
    // finds the entry point still there rather than the empty row the control hands back.
    if (draft.implMap !== undefined)
      lastImplMap.current = draft.implMap
    const next = implMap !== undefined && draft.implMap === undefined ? lastImplMap.current ?? implMap : implMap
    edit({ implMap: next })
  }

  /** A box that holds a number, beside the label that names it. */
  const numberPair = (label: string, text: string, onChange: (text: string) => void): React.JSX.Element => (
    <label className="options-pair">
      <span className="options-row-label">{t(label)}</span>
      <input aria-label={t(label)} value={text} onChange={(event) => { onChange(event.target.value) }} />
    </label>
  )

  return (
    <OptionsShell
      title={isNew ? 'Create Field' : 'Edit Field'}
      className="field-options"
      tabs={[
        {
          label: 'Main',
          content: (
            <div className="options-page">
              <div className="options-pairs">
                <label className="options-pair">
                  <span className="options-row-label">{t('Name')}</span>
                  <input aria-label={t('Name')} value={draft.name} onChange={(event) => { edit({ name: event.target.value }) }} />
                </label>
                <label className="options-pair">
                  <span className="options-row-label">{t('Access')}</span>
                  <select aria-label={t('Access')} value={fieldAccessOf(draft.attributes)} onChange={(event) => { edit({ attributes: withFieldAccess(draft.attributes, Number(event.target.value)) }) }}>
                    {FIELD_ACCESSES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                  </select>
                </label>
              </div>

              {/* The header is the resource string the XAML binds, and the six captions are the enum's
                  own names. */}
              <fieldset className="ca-group">
                <legend>{t('Flags')}</legend>
                <div className="options-flags">
                  {FIELD_FLAGS.map((entry) => (
                    <label className="options-row" key={entry.label}>
                      <input
                        type="checkbox"
                        checked={hasFieldFlag(draft.attributes, entry.flag)}
                        onChange={(event) => { edit({ attributes: withFieldFlag(draft.attributes, entry.flag, event.target.checked) }) }}
                      />
                      {entry.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* dnSpy's checkbox is what the HasDefault bit follows, so the two are the same state. */}
              <ConstantEditor
                value={draft.constant}
                onChange={(constant) => { edit({ constant }) }}
                tooltip="Default value for this field"
              />

              <div className="options-pairs">
                {numberPair('Offset', draft.fieldOffset, (fieldOffset) => { edit({ fieldOffset }) })}
                {/* The checkbox captions the initial value's box and is what enables it; the box keeps
                    what it holds while the checkbox is off, which is how dnSpy's binding draws it. */}
                <label className="options-row">
                  <input
                    type="checkbox"
                    checked={draft.hasFieldRVA}
                    onChange={(event) => { edit({ hasFieldRVA: event.target.checked }) }}
                  />
                  {t('Initial Value')}
                </label>
                <input
                  aria-label={t('Initial Value')}
                  value={draft.initialValue}
                  disabled={!draft.hasFieldRVA}
                  onChange={(event) => { edit({ initialValue: event.target.value }) }}
                />
                {numberPair('RVA', draft.rva, (rva) => { edit({ rva }) })}
              </div>
            </div>
          ),
        },
        {
          label: 'Type',
          content: (
            <TypeSigEditor
              workspaceId={workspaceId}
              value={draft.fieldSig ?? null}
              onChange={(fieldSig) => { edit({ fieldSig: fieldSig ?? undefined }) }}
              options={signatureOptions}
            />
          ),
        },
        {
          label: 'Marshal Type',
          content: (
            <MarshalTypeEditor
              workspaceId={workspaceId}
              value={draft.marshalType}
              onChange={(marshalType) => { edit({ marshalType }) }}
              options={signatureOptions}
            />
          ),
        },
        {
          label: 'ImplMap',
          content: <ImplMapEditor value={draft.implMap} onChange={setImplMap} />,
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
      ]}
      invalid={error !== undefined}
      // The page's own complaint wins while there is one: it is what is holding OK down right now, and
      // the refused write it followed is already out of date.
      error={error === undefined ? failure : t(error.template, error.args)}
      onReset={() => { lastImplMap.current = undefined; setDraft(fieldOptionsDraft(value)) }}
      onAccept={() => { onAccept(fieldOptionsDto(draft)) }}
      onClose={onCancel}
    />
  )
}
