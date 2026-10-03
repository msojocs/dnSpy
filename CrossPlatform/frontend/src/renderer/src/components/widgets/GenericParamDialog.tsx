import { useState } from 'react'
import { useLanguage } from '../../localization'
import type { ListEditorItemProps } from '../ListEditor'
import { OptionsShell } from '../OptionsShell'
import { CustomAttributeListEditor } from './CustomAttributeListEditor'
import {
  GENERIC_PARAM_FLAGS, genericParamError, hasGenericParamFlag, GP_VARIANCES, varianceOf, withGenericParamFlag,
  withVariance, type GenericParamDraft,
} from './generic-param'
import { TypeDefOrRefAndCAsListEditor } from './TypeDefOrRefAndCAsListEditor'
import { TypeSigEditor, type TypeSigEditorOptions } from './TypeSigEditor'

interface GenericParamDialogProps extends ListEditorItemProps<GenericParamDraft> {
  workspaceId: string
  /** What every signature on this page may hold, which dnSpy works out once from the owner: the type's
   * generic parameters may be used when it has any, the method's when it has any. It is the same rule
   * for the `Kind` page and for each constraint, so both take it from here. */
  options?: TypeSigEditorOptions
}

/** dnSpy's `GenericParamDlg`: one window for Create and Edit, whose four pages are the parameter's own
 * name and number, its constraints, the attributes on it, and the `Kind` nothing reads. */
export const GenericParamDialog = ({ workspaceId, value, isNew, options, onAccept, onCancel }: GenericParamDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  // The row's own value is already a draft, and it is never written into — every edit replaces it.
  const [draft, setDraft] = useState<GenericParamDraft>(value)
  const error = genericParamError(draft)
  const edit = (patch: Partial<GenericParamDraft>): void => { setDraft({ ...draft, ...patch }) }

  const main = (
    <div className="param-def">
      <div className="param-def-grid">
        <div className="marshal-field">
          <span className="marshal-label">{t('Name')}</span>
          <input aria-label={t('Name')} value={draft.name} onChange={(event) => { edit({ name: event.target.value }) }} />
        </div>
        <div className="marshal-field">
          <span className="marshal-label">{t('Number')}</span>
          <input aria-label={t('Number')} value={draft.number} onChange={(event) => { edit({ number: event.target.value }) }} />
        </div>
      </div>

      <fieldset className="ca-group">
        <legend>{t('Constraints')}</legend>
        <div className="param-flags">
          {GENERIC_PARAM_FLAGS.map((entry) => (
            <label key={entry.label}>
              <input
                type="checkbox"
                checked={hasGenericParamFlag(draft.attributes, entry.flag)}
                onChange={(event) => { edit({ attributes: withGenericParamFlag(draft.attributes, entry.flag, event.target.checked) }) }}
              />
              {t(entry.label)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="param-def-grid">
        <div className="marshal-field">
          <span className="marshal-label">{t('Variance')}</span>
          <select
            aria-label={t('Variance')}
            value={varianceOf(draft.attributes)}
            onChange={(event) => { edit({ attributes: withVariance(draft.attributes, Number(event.target.value)) }) }}
          >
            {GP_VARIANCES.map((entry) => <option key={entry.label} value={entry.value}>{t(entry.label)}</option>)}
          </select>
        </div>
      </div>
    </div>
  )

  return (
    <OptionsShell
      title={isNew ? 'Create Generic Parameter' : 'Edit Generic Parameter'}
      tabs={[
        { label: 'Main', content: main },
        {
          label: 'Constraints',
          content: (
            <TypeDefOrRefAndCAsListEditor
              workspaceId={workspaceId}
              items={draft.constraints}
              onChange={(constraints) => { edit({ constraints }) }}
              options={options}
              editTitle="Edit Generic Parameter Constraint"
              createTitle="Create Generic Parameter Constraint"
              ariaLabel={t('Constraints')}
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
          // The page dnSpy tells you to ignore, in the tooltip that is the whole reason it can be.
          label: 'Kind',
          tooltip: 'Only used if MD header version is 1.1 (0x0101). It\'s never 1.1 so ignore Kind',
          content: (
            <TypeSigEditor
              workspaceId={workspaceId}
              value={draft.kind}
              onChange={(kind) => { edit({ kind }) }}
              options={options}
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
