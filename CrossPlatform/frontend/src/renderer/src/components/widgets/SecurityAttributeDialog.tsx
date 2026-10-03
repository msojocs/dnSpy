import { useState } from 'react'
import type { TreeNode } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import type { ListEditorItemProps } from '../ListEditor'
import { OptionsShell } from '../OptionsShell'
import { TypePickerDialog } from '../TypePickerDialog'
import { CaNamedArgumentListEditor } from './CaNamedArgumentListEditor'
import { securityAttributeError, type SecurityAttributeDraft } from './security-attribute'
import { describeTypeSig, NOT_SET, referenceOf } from './type-sig-text'

interface SecurityAttributeDialogProps extends ListEditorItemProps<SecurityAttributeDraft> {
  workspaceId: string
}

/**
 * dnSpy's `SecurityAttributeDlg`: the attribute's type, and the named arguments that are all of its
 * values. It has no pages of its own — the WPF control is a picker row over a list — so it opens with
 * the tab strip gone.
 *
 * The type is picked rather than typed: dnSpy opens its own picker restricted to type definitions, and
 * the box beside the button only ever shows what came back.
 */
export const SecurityAttributeDialog = ({ workspaceId, value, isNew, onAccept, onCancel }: SecurityAttributeDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  // The row's own value is already a draft, and it is never written into — every edit replaces it.
  const [draft, setDraft] = useState<SecurityAttributeDraft>(value)
  const [picking, setPicking] = useState(false)
  const error = securityAttributeError(draft)

  const content = (
    <div className="security-attribute">
      <div className="security-attribute-picker">
        <button
          type="button"
          className="icon-button"
          aria-label={t('Pick a Type')}
          title={t('Pick a Type')}
          onClick={() => { setPicking(true) }}
        >
          ...
        </button>
        <input readOnly aria-label={t('Type')} title={t('Type')} value={draft.attributeType === null ? '' : describeTypeSig(draft.attributeType, NOT_SET)} />
      </div>

      <fieldset className="ca-group">
        <legend>{t('Named Arguments')}</legend>
        <CaNamedArgumentListEditor
          workspaceId={workspaceId}
          items={draft.namedArguments}
          onChange={(namedArguments) => { setDraft({ ...draft, namedArguments }) }}
        />
      </fieldset>
    </div>
  )

  return (
    <>
      <OptionsShell
        title={isNew ? 'Create Security Attribute' : 'Edit Security Attribute'}
        tabs={[{ label: 'Main', content }]}
        hideTabStrip
        invalid={error !== undefined}
        error={error === undefined ? undefined : t(error.template, error.args)}
        onReset={() => { setDraft(value) }}
        onAccept={() => { onAccept(draft) }}
        onClose={onCancel}
      />
      {picking && (
        <TypePickerDialog
          workspaceId={workspaceId}
          mode="type"
          onPick={(node: TreeNode, trail: TreeNode[]) => {
            setDraft((current) => ({ ...current, attributeType: { kind: 'type', type: referenceOf(node, trail) } }))
            setPicking(false)
          }}
          onClose={() => { setPicking(false) }}
        />
      )}
    </>
  )
}
