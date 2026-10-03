import { useState } from 'react'
import type { TreeNode } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import type { ListEditorItemProps } from '../ListEditor'
import { OptionsShell } from '../OptionsShell'
import { TypePickerDialog } from '../TypePickerDialog'
import type { MethodOverrideDraft } from './method-override'
import { pickedMethodRef } from './method-ref'

interface MethodOverrideDialogProps extends ListEditorItemProps<MethodOverrideDraft> {
  workspaceId: string
}

/**
 * dnSpy has no dialog for a method override: `EditMethodOverride` opens the method picker and takes the
 * declaration alone from what it returns, so Add... and Edit... both come down to picking one method.
 * The body is not asked for — it is the method being edited, and the backend fills it in for a row that
 * arrives without one — and a row that was already in the list keeps the body it came with.
 */
export const MethodOverrideDialog = ({ workspaceId, value, onAccept, onCancel }: MethodOverrideDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  const [failure, setFailure] = useState<string>()

  const pick = async (node: TreeNode, trail: TreeNode[]): Promise<void> => {
    try {
      // The method's own options are where its name and signature live, which is what a reference to it
      // is made of; the type the picker found it under comes from the trail.
      const response = await window.dnSpy.getNodeOptions(workspaceId, 'method', { nodeId: node.id })
      const declaration = response.method ? pickedMethodRef(trail, response.method) : undefined
      if (!declaration) {
        setFailure(t('The selected method cannot be used as an override.'))
        return
      }
      onAccept({ ...value, methodDeclaration: declaration })
    }
    catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause))
    }
  }

  // A method the tree cannot describe completely — one with no type above it, or no signature — leaves
  // nothing to write into the row. The list is still waiting on this dialog, so it is answered with a
  // window that says why and can only be dismissed.
  if (failure) {
    return (
      <OptionsShell
        title="Edit Method Override"
        hideTabStrip
        className="ca-shell"
        tabs={[{ label: 'Method Override', content: <div className="options-error">{failure}</div> }]}
        invalid
        error={failure}
        onAccept={onCancel}
        onClose={onCancel}
      />
    )
  }

  return (
    <TypePickerDialog
      workspaceId={workspaceId}
      mode="method"
      onPick={(node, trail) => { void pick(node, trail) }}
      onClose={onCancel}
    />
  )
}
