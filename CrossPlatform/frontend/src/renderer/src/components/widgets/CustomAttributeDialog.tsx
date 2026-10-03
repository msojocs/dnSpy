import { useState } from 'react'
import type { TreeNode } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import { type ListEditorItemProps } from '../ListEditor'
import { OptionsShell } from '../OptionsShell'
import { TypePickerDialog } from '../TypePickerDialog'
import { CaArgumentEditor } from './CaArgumentEditor'
import { CaNamedArgumentListEditor } from './CaNamedArgumentListEditor'
import { customAttributeArguments, customAttributeError, type CustomAttributeDraft } from './custom-attribute'
import { methodRefDisplay, pickedMethodRef } from './method-ref'
import { NOT_SET } from './type-sig-text'

interface CustomAttributeDialogProps extends ListEditorItemProps<CustomAttributeDraft> {
  workspaceId: string
}

/**
 * dnSpy's `CustomAttributeDlg`: a constructor to pick, the arguments that constructor's signature calls
 * for, and the named arguments beside them. It has no tab strip — the one page is the whole dialog — and
 * it is the same dialog for Create and Edit, which is why its title says Edit either way.
 *
 * Picking a constructor drops every argument and builds one per parameter of the new one, which is what
 * `CustomAttributeVM`'s `Constructor` setter does; the named arguments are left alone. The draft only
 * leaves the dialog when OK is pressed, so Cancel writes nothing back.
 */
export const CustomAttributeDialog = ({ workspaceId, value, onAccept, onCancel }: CustomAttributeDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  // The row's own value is already a draft, and it is never written into — every edit replaces it.
  const [draft, setDraft] = useState<CustomAttributeDraft>(value)
  const [picking, setPicking] = useState(false)
  const [failure, setFailure] = useState<string>()
  const error = customAttributeError(draft)

  const pickConstructor = async (node: TreeNode, trail: TreeNode[]): Promise<void> => {
    setPicking(false)
    try {
      // The method's own options are where its name and signature live, which is what a reference to it
      // is made of; the type the picker found it under comes from the trail.
      const response = await window.dnSpy.getNodeOptions(workspaceId, 'method', { nodeId: node.id })
      const constructor = response.method ? pickedMethodRef(trail, response.method) : undefined
      if (!constructor) {
        setFailure(t('The selected method cannot be used as a constructor.'))
        return
      }
      setFailure(undefined)
      setDraft({ constructor, constructorArguments: customAttributeArguments(constructor), namedArguments: draft.namedArguments })
    }
    catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const page = (
    <div className="ca-dialog">
      <div className="ca-constructor">
        <button type="button" title={t('Pick a Constructor')} aria-label={t('Pick a Constructor')} onClick={() => { setPicking(true) }}>...</button>
        <input readOnly aria-label={t('Constructor')} value={draft.constructor === undefined ? t(NOT_SET) : methodRefDisplay(draft.constructor)} />
      </div>
      <fieldset className="ca-group">
        <legend>{t('Constructor Arguments')}</legend>
        {draft.constructorArguments.length === 0 && <div className="ca-group-empty">{t('(none)')}</div>}
        {draft.constructorArguments.map((argument, index) => (
          <CaArgumentEditor
            key={index}
            workspaceId={workspaceId}
            value={argument}
            onChange={(next) => { setDraft({ ...draft, constructorArguments: draft.constructorArguments.map((current, at) => at === index ? next : current) }) }}
            allowNull={false}
          />
        ))}
      </fieldset>
      <fieldset className="ca-group">
        <legend>{t('Named Arguments')}</legend>
        <CaNamedArgumentListEditor
          workspaceId={workspaceId}
          items={draft.namedArguments}
          onChange={(namedArguments) => { setDraft({ ...draft, namedArguments }) }}
        />
      </fieldset>
      {failure && <div className="options-error">{failure}</div>}
    </div>
  )

  return (
    <>
      <OptionsShell
        title="Edit Custom Attribute"
        hideTabStrip
        className="ca-shell"
        tabs={[{ label: 'Custom Attribute', content: page }]}
        invalid={error !== undefined}
        error={error === undefined ? undefined : t(error.template, error.args)}
        onReset={() => { setDraft(value) }}
        onAccept={() => { onAccept(draft) }}
        onClose={onCancel}
      />
      {picking && (
        <TypePickerDialog
          workspaceId={workspaceId}
          mode="constructor"
          onPick={(node, trail) => { void pickConstructor(node, trail) }}
          onClose={() => { setPicking(false) }}
        />
      )}
    </>
  )
}
