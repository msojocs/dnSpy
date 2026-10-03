import { useState } from 'react'
import type { TypeOptionsDto } from '../../../shared/protocol'
import { useLanguage } from '../localization'
import { OptionsShell } from './OptionsShell'
import { CustomAttributeListEditor } from './widgets/CustomAttributeListEditor'
import { DeclSecurityListEditor } from './widgets/DeclSecurityListEditor'
import { GenericParamListEditor } from './widgets/GenericParamListEditor'
import { TypeDefOrRefAndCAsListEditor } from './widgets/TypeDefOrRefAndCAsListEditor'
import { TypeSigEditor, type TypeSigEditorOptions } from './widgets/TypeSigEditor'
import { applyTypeKind, hasTypeFlag, initializeTypeKind, TYPE_CUSTOM_FORMATS, TYPE_FLAGS, TYPE_KINDS, TYPE_LAYOUTS, TYPE_SEMANTICS, TYPE_STRING_FORMATS, typeCustomFormatOf, typeLayoutOf, typeOptionsDraft, typeOptionsDto, typeOptionsError, typeSemanticsOf, typeStringFormatOf, typeVisibilityOf, typeVisibilities, withTypeCustomFormat, withTypeFlag, withTypeLayout, withTypeSemantics, withTypeStringFormat, withTypeVisibility, type TypeOptionsDraft } from './widgets/type-options'

interface TypeOptionsDialogProps {
  workspaceId: string
  /** The model the dialog opens with: what the type holds, or the defaults a new one starts from. */
  value: TypeOptionsDto
  isNew: boolean
  /** Whether a new type is being created inside the selected one, which only changes the title — dnSpy's
   * Create Type and Create Nested Type are two commands over the same window. */
  nested?: boolean
  /** Why the backend refused the last attempt to write this model. The window keeps the model, so the
   * reason goes beside it rather than replacing it. */
  failure?: string
  onAccept(options: TypeOptionsDto): void
  onCancel(): void
}

/**
 * dnSpy's `TypeOptionsDlg`: the type editor's pages on one window, which is the same window for creating
 * and editing — only the title and the model it starts with differ.
 *
 * The six combinations and the nine flag boxes are all views of one attribute word, which is why every
 * one of them writes back into it rather than keeping a value of its own. Two of them are what the kind
 * combo is derived from, so a change to the layout, the semantics, a flag or the base type brings the
 * kind back in step, while a change to the name or the visibility leaves it where the user put it — which
 * is what dnSpy's view model does, and the reason the kind is kept in the draft at all.
 */
export const TypeOptionsDialog = ({ workspaceId, value, isNew, nested = false, failure, onAccept, onCancel }: TypeOptionsDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<TypeOptionsDraft>(() => typeOptionsDraft(value))
  const error = typeOptionsError(draft)

  /**
   * What the base type editor may hold, which is dnSpy's `TypeSigCreatorOptions` for this dialog: the
   * type's own generic parameters when it has any, no method ones, and no function pointers.
   */
  const signatureOptions: TypeSigEditorOptions = {
    canAddGenericTypeVar: value.typeGenericParameterCount === undefined || value.typeGenericParameterCount > 0,
    canAddGenericMethodVar: false,
    canAddFnPtr: false,
    isLocal: false,
  }

  const edit = (patch: Partial<TypeOptionsDraft>): void => { setDraft({ ...draft, ...patch }) }

  /** The edits dnSpy re-derives the kind on: the layout, the semantics, a flag and the base type. */
  const editDeriving = (patch: Partial<TypeOptionsDraft>): void => { setDraft(initializeTypeKind({ ...draft, ...patch })) }

  /** The kind's own edit, which writes the rest of the model rather than being derived from it, and so
   * is the one edit the kind is not re-derived after. */
  const setKind = (kind: number): void => { setDraft(applyTypeKind(draft, kind)) }

  /** A box that holds a number, beside the label that names it. */
  const numberPair = (label: string, text: string, onChange: (text: string) => void): React.JSX.Element => (
    <label className="options-pair">
      <span className="options-row-label">{t(label)}</span>
      <input aria-label={t(label)} value={text} onChange={(event) => { onChange(event.target.value) }} />
    </label>
  )

  /** One of the six combinations, each of which is a slice of the attribute word. */
  const combo = (label: string, entries: { label: string, value: number }[], selected: number, onChange: (value: number) => void): React.JSX.Element => (
    <label className="options-pair">
      <span className="options-row-label">{t(label)}</span>
      <select aria-label={t(label)} value={selected} onChange={(event) => { onChange(Number(event.target.value)) }}>
        {entries.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
    </label>
  )

  return (
    <OptionsShell
      title={isNew ? (nested ? 'Create Nested Type' : 'Create Type') : 'Edit Type'}
      className="type-options"
      tabs={[
        {
          label: 'Main',
          content: (
            <div className="options-page">
              <div className="options-pairs">
                <label className="options-pair">
                  <span className="options-row-label">{t('Namespace')}</span>
                  <input aria-label={t('Namespace')} value={draft.namespace} onChange={(event) => { edit({ namespace: event.target.value }) }} />
                </label>
                <label className="options-pair">
                  <span className="options-row-label">{t('Name')}</span>
                  <input aria-label={t('Name')} value={draft.name} onChange={(event) => { edit({ name: event.target.value }) }} />
                </label>
                {numberPair('Packing Size', draft.packingSize, (packingSize) => { edit({ packingSize }) })}
                {numberPair('Class Size', draft.classSize, (classSize) => { edit({ classSize }) })}
              </div>

              {/* The header is the resource string the XAML binds, and the nine captions are the boxes'
                  own text. */}
              <fieldset className="ca-group">
                <legend>{t('Flags')}</legend>
                <div className="options-flags">
                  {TYPE_FLAGS.map((entry) => (
                    <label className="options-row" key={entry.label}>
                      <input
                        type="checkbox"
                        checked={hasTypeFlag(draft.attributes, entry.flag)}
                        onChange={(event) => { editDeriving({ attributes: withTypeFlag(draft.attributes, entry.flag, event.target.checked) }) }}
                      />
                      {entry.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* Two rows of three: the kind, the visibility — whose label is the accessibility one for a
                  nested type, since that is what its visibility is — the layout, and then the three that
                  are only ever a slice of the word. */}
              <div className="options-combos">
                {combo('Kind', TYPE_KINDS, draft.kind, setKind)}
                {combo(draft.isNested ? 'Accessibility' : 'Visibility', typeVisibilities(draft.isNested), typeVisibilityOf(draft.attributes), (visibility) => { edit({ attributes: withTypeVisibility(draft.attributes, visibility) }) })}
                {combo('Layout', TYPE_LAYOUTS, typeLayoutOf(draft.attributes), (layout) => { editDeriving({ attributes: withTypeLayout(draft.attributes, layout) }) })}
                {combo('String', TYPE_STRING_FORMATS, typeStringFormatOf(draft.attributes), (format) => { edit({ attributes: withTypeStringFormat(draft.attributes, format) }) })}
                {combo('Semantics', TYPE_SEMANTICS, typeSemanticsOf(draft.attributes), (semantics) => { editDeriving({ attributes: withTypeSemantics(draft.attributes, semantics) }) })}
                {combo('Custom', TYPE_CUSTOM_FORMATS, typeCustomFormatOf(draft.attributes), (format) => { edit({ attributes: withTypeCustomFormat(draft.attributes, format) }) })}
              </div>
            </div>
          ),
        },
        {
          label: 'Base Type',
          content: (
            <div className="options-page">
              <TypeSigEditor
                workspaceId={workspaceId}
                value={draft.baseType ?? null}
                onChange={(baseType) => { editDeriving({ baseType: baseType ?? undefined }) }}
                options={signatureOptions}
              />
            </div>
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
          // An interface is the same row a generic parameter's constraint is — a type with attributes on
          // it — which is the one control dnSpy serves both with, titles and all.
          label: 'Interfaces',
          content: (
            <TypeDefOrRefAndCAsListEditor
              workspaceId={workspaceId}
              items={draft.interfaces}
              onChange={(interfaces) => { edit({ interfaces }) }}
              options={signatureOptions}
              editTitle="Edit Interface Impl"
              createTitle="Create Interface Impl"
              ariaLabel={t('Interfaces')}
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
      onReset={() => { setDraft(typeOptionsDraft(value)) }}
      onAccept={() => { onAccept(typeOptionsDto(draft)) }}
      onClose={onCancel}
    />
  )
}
