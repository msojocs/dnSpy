import { useState } from 'react'
import { useLanguage } from '../../localization'
import type { ListEditorItemProps } from '../ListEditor'
import { OptionsShell } from '../OptionsShell'
import { CustomAttributeListEditor } from './CustomAttributeListEditor'
import { typeDefOrRefAndCaError, type TypeDefOrRefAndCaDraft } from './type-def-or-ref-and-ca'
import { TypeSigEditor, type TypeSigEditorOptions } from './TypeSigEditor'

interface TypeDefOrRefAndCaDialogProps extends ListEditorItemProps<TypeDefOrRefAndCaDraft> {
  workspaceId: string
  /** dnSpy's `ListVM` hands its two strings to the dialog, which uses them as its title: the two lists
   * this dialog serves — a constraint and an interface — name themselves differently. */
  editTitle: string
  createTitle: string
  /** What the signature editor may hold, which is what dnSpy's `TypeSigCreatorOptions` says for a
   * constraint: the owner type's generic parameters may be used, and the method's when it has any. */
  options?: TypeSigEditorOptions
}

/** dnSpy's `TypeDefOrRefAndCADlg`: the type to name, and the custom attributes on it. */
export const TypeDefOrRefAndCaDialog = ({ workspaceId, value, isNew, editTitle, createTitle, options, onAccept, onCancel }: TypeDefOrRefAndCaDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  // The row's own value is already a draft, and it is never written into — every edit replaces it.
  const [draft, setDraft] = useState<TypeDefOrRefAndCaDraft>(value)
  const error = typeDefOrRefAndCaError(draft)
  const edit = (patch: Partial<TypeDefOrRefAndCaDraft>): void => { setDraft({ ...draft, ...patch }) }

  return (
    <OptionsShell
      title={isNew ? createTitle : editTitle}
      tabs={[
        {
          label: 'Type',
          content: (
            <TypeSigEditor
              workspaceId={workspaceId}
              value={draft.type}
              onChange={(type) => { edit({ type }) }}
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
