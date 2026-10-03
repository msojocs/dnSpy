import { useState } from 'react'
import type { TreeNode } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import type { ListEditorItemProps } from '../ListEditor'
import { OptionsShell } from '../OptionsShell'
import { TypePickerDialog } from '../TypePickerDialog'
import { pickedAccessorRef, type AccessorRefRow } from './accessor-ref'

interface AccessorRefPickerDialogProps extends ListEditorItemProps<AccessorRefRow> {
  workspaceId: string
  /** The nodes the picker may look under, which is dnSpy's `SameModuleDocumentTreeNodeFilter`: an
   * accessor is a `MethodSemantics` row, and those point at methods of the same module. */
  rootNodeIds?: string[]
}

/**
 * The dialog behind a row of an accessor list, which is dnSpy's `MethodDefsVM` row editor: Add... and
 * Edit... both open the method picker, and the row is whatever comes back from it. There is no window of
 * its own beyond the picker's, which is what dnSpy's `EditMethodDef.Edit` does with the title the list
 * VM hands it.
 */
export const AccessorRefPickerDialog = ({ workspaceId, rootNodeIds, onAccept, onCancel }: AccessorRefPickerDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  const [failure, setFailure] = useState<string>()

  const pick = async (node: TreeNode, trail: TreeNode[]): Promise<void> => {
    try {
      // The method's own options are where its name and signature live, which is what the row shows and
      // what the backend needs to describe it again; the type above it comes from the trail.
      const response = await window.dnSpy.getNodeOptions(workspaceId, 'method', { nodeId: node.id })
      const reference = response.method ? pickedAccessorRef(trail, node.id, response.method) : undefined
      if (!reference) {
        setFailure(t('The selected method cannot be used as an accessor.'))
        return
      }
      onAccept(reference)
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
        title="Pick a Method"
        hideTabStrip
        className="ca-shell"
        tabs={[{ label: 'Method', content: <div className="options-error">{failure}</div> }]}
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
      rootNodeIds={rootNodeIds}
      onPick={(node, trail) => { void pick(node, trail) }}
      onClose={onCancel}
    />
  )
}
