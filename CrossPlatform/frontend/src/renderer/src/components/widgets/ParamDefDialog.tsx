import { useState } from 'react'
import { useLanguage } from '../../localization'
import type { ListEditorItemProps } from '../ListEditor'
import { OptionsShell } from '../OptionsShell'
import { ConstantEditor } from './ConstantEditor'
import { CustomAttributeListEditor } from './CustomAttributeListEditor'
import { MarshalTypeEditor } from './MarshalTypeEditor'
import { hasParamFlag, PARAM_FLAGS, paramDefError, type ParamDefDraft, withParamFlag } from './param-def'
import type { TypeSigEditorOptions } from './TypeSigEditor'

interface ParamDefDialogProps extends ListEditorItemProps<ParamDefDraft> {
  workspaceId: string
  /** What the marshal type's embedded signature editors may hold: a parameter has no generic parameters
   * of its own, so they are read against the method and its declaring type. */
  options?: TypeSigEditorOptions
}

/** dnSpy's `ParamDefDlg`: one window for Create and Edit, whose three pages are the name and its flags,
 * the marshalling, and the custom attributes. */
export const ParamDefDialog = ({ workspaceId, value, isNew, options, onAccept, onCancel }: ParamDefDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  // The row's own value is already a draft, and it is never written into — every edit replaces it.
  const [draft, setDraft] = useState<ParamDefDraft>(value)
  const error = paramDefError(draft)
  const edit = (patch: Partial<ParamDefDraft>): void => { setDraft({ ...draft, ...patch }) }

  const main = (
    <div className="param-def">
      <div className="param-def-grid">
        <div className="marshal-field">
          <span className="marshal-label">{t('Name')}</span>
          <input aria-label={t('Name')} value={draft.name} onChange={(event) => { edit({ name: event.target.value }) }} />
        </div>
        <div className="marshal-field">
          {/* Which parameter a row is about is what the sequence number says, so dnSpy spells it out. */}
          <span className="marshal-label" title={t('Sequence 0 is return parameter, sequence 1 is first parameter, etc')}>{t('Sequence')}</span>
          <input
            aria-label={t('Sequence')}
            title={t('Sequence 0 is return parameter, sequence 1 is first parameter, etc')}
            value={draft.sequence}
            onChange={(event) => { edit({ sequence: event.target.value }) }}
          />
        </div>
      </div>

      <fieldset className="ca-group">
        <legend>{t('Flags')}</legend>
        <div className="param-flags">
          {PARAM_FLAGS.map((entry) => (
            <label key={entry.label}>
              <input
                type="checkbox"
                checked={hasParamFlag(draft.attributes, entry.flag)}
                onChange={(event) => { edit({ attributes: withParamFlag(draft.attributes, entry.flag, event.target.checked) }) }}
              />
              {t(entry.label)}
            </label>
          ))}
        </div>
      </fieldset>

      {/* dnSpy's checkbox is what the HasDefault bit follows, so the two are the same state here. */}
      <ConstantEditor
        value={draft.constant}
        onChange={(constant) => { edit({ constant }) }}
        tooltip="Default value for this parameter"
      />
    </div>
  )

  return (
    <OptionsShell
      title={isNew ? 'Create Parameter' : 'Edit Parameter'}
      tabs={[
        { label: 'Main', content: main },
        {
          label: 'Marshal Type',
          content: (
            <MarshalTypeEditor
              workspaceId={workspaceId}
              value={draft.marshalType}
              onChange={(marshalType) => { edit({ marshalType }) }}
              options={options}
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
      ]}
      invalid={error !== undefined}
      error={error === undefined ? undefined : t(error.template, error.args)}
      onReset={() => { setDraft(value) }}
      onAccept={() => { onAccept(draft) }}
      onClose={onCancel}
    />
  )
}
