import { useState } from 'react'
import type { PropertyOptionsDto } from '../../../shared/protocol'
import { useLanguage } from '../localization'
import { OptionsShell } from './OptionsShell'
import type { AccessorRefRow } from './widgets/accessor-ref'
import { AccessorRefListEditor } from './widgets/AccessorRefListEditor'
import { ConstantEditor } from './widgets/ConstantEditor'
import { CustomAttributeListEditor } from './widgets/CustomAttributeListEditor'
import { hasPropertyFlag, PROPERTY_FLAGS, propertyOptionsDraft, propertyOptionsDto, propertyOptionsError, withPropertyFlag, type PropertyOptionsDraft } from './widgets/property-options'
import { PropertySigEditor } from './widgets/PropertySigEditor'
import type { TypeSigEditorOptions } from './widgets/TypeSigEditor'

interface PropertyOptionsDialogProps {
  workspaceId: string
  /** The model the dialog opens with: what the property holds, or the defaults a new one starts from. */
  value: PropertyOptionsDto
  isNew: boolean
  /** Why the backend refused the last attempt to write this model. The window keeps the model, so the
   * reason goes beside it rather than replacing it. */
  failure?: string
  onAccept(options: PropertyOptionsDto): void
  onCancel(): void
}

/**
 * dnSpy's `PropertyOptionsDlg`: the six pages of the property editor on one window, which is the same
 * window for creating and editing — only the title and the model it starts with differ.
 *
 * The three accessor pages are the ones that need care. Their rows name methods of the type being
 * edited, and the marks that make a method a getter or a setter live on the methods themselves, so the
 * backend clears every mark in the old lists before setting any in the new ones — which is why the pages
 * hand whole lists over rather than the difference between them.
 */
export const PropertyOptionsDialog = ({ workspaceId, value, isNew, failure, onAccept, onCancel }: PropertyOptionsDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<PropertyOptionsDraft>(() => propertyOptionsDraft(value))
  const error = propertyOptionsError(draft)

  /**
   * What the signature's type editors may hold, which is dnSpy's `TypeSigCreatorOptions` for this
   * dialog: the owner type's generic parameters when it has any, and method generic parameters — a
   * property's indexer parameters are allowed to name them. No function pointers.
   */
  const signatureOptions: TypeSigEditorOptions = {
    canAddGenericTypeVar: (value.ownerGenericParameterCount ?? 0) > 0,
    canAddGenericMethodVar: true,
    canAddFnPtr: false,
    isLocal: false,
  }

  const edit = (patch: Partial<PropertyOptionsDraft>): void => { setDraft({ ...draft, ...patch }) }

  /** The list a page edits, as the one field of the draft it writes back to — spelled out rather than
   * computed, since a computed key would have to be cast back to the draft's shape to be assignable. */
  const accessorPatch = (key: 'getMethods' | 'setMethods' | 'otherMethods', rows: AccessorRefRow[]): Partial<PropertyOptionsDraft> =>
    key === 'getMethods' ? { getMethods: rows } : key === 'setMethods' ? { setMethods: rows } : { otherMethods: rows }

  /** One of the three accessor pages, which are the same list under three different names. */
  const accessors = (label: string, key: 'getMethods' | 'setMethods' | 'otherMethods'): { label: string, content: React.JSX.Element } => ({
    label,
    content: (
      <AccessorRefListEditor
        workspaceId={workspaceId}
        items={draft[key]}
        onChange={(rows) => { edit(accessorPatch(key, rows)) }}
        ariaLabel={t(label)}
      />
    ),
  })

  return (
    <OptionsShell
      title={isNew ? 'Create Property' : 'Edit Property'}
      className="property-options"
      tabs={[
        {
          label: 'Main',
          content: (
            <div className="options-page">
              <label className="options-name">
                <span className="options-row-label">{t('Name')}</span>
                <input aria-label={t('Name')} value={draft.name} onChange={(event) => { edit({ name: event.target.value }) }} />
              </label>

              {/* The header is the resource string the XAML binds, and the two captions are the enum's
                  own names. */}
              <fieldset className="ca-group">
                <legend>{t('Flags')}</legend>
                <div className="options-flags-two">
                  {PROPERTY_FLAGS.map((entry) => (
                    <label className="options-row" key={entry.label}>
                      <input
                        type="checkbox"
                        checked={hasPropertyFlag(draft.attributes, entry.flag)}
                        onChange={(event) => { edit({ attributes: withPropertyFlag(draft.attributes, entry.flag, event.target.checked) }) }}
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
                tooltip="Default value for this property"
              />
            </div>
          ),
        },
        {
          label: 'Signature',
          content: (
            <PropertySigEditor
              workspaceId={workspaceId}
              value={draft.propertySig ?? { hasThis: true, propertyType: { kind: 'empty' }, parameters: [] }}
              onChange={(propertySig) => { edit({ propertySig }) }}
              options={signatureOptions}
            />
          ),
        },
        accessors('Getters', 'getMethods'),
        accessors('Setters', 'setMethods'),
        accessors('Other Methods', 'otherMethods'),
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
      onReset={() => { setDraft(propertyOptionsDraft(value)) }}
      onAccept={() => { onAccept(propertyOptionsDto(draft)) }}
      onClose={onCancel}
    />
  )
}
