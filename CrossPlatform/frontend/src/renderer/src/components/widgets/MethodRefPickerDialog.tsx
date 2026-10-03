import { useState } from 'react'
import type { TreeNode } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import type { ListEditorItemProps } from '../ListEditor'
import { OptionsShell } from '../OptionsShell'
import { TypePickerDialog } from '../TypePickerDialog'
import { pickedMethodRef, type MethodRefRow } from './method-ref'

interface MethodRefPickerDialogProps extends ListEditorItemProps<MethodRefRow> {
  workspaceId: string
  /** The module the method has to come from, which is the module the row will be written into: an
   * accessor is a `MethodSemantics` row, and those point at methods of the same module. */
  rootNodeIds?: string[]
}

/**
 * The dialog behind a method row of an accessor list, which is dnSpy's `EditMethodDef`: Add... and
 * Edit... both open the method picker and the row is whatever comes back from it. There is no window of
 * its own — `EditMethodDef.Edit` drops the title the list VM hands it and the picker titles itself —
 * so what the user sees is the picker's own window and nothing else.
 */
export const MethodRefPickerDialog = ({ workspaceId, rootNodeIds, onAccept, onCancel }: MethodRefPickerDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  const [failure, setFailure] = useState<string>()

  const pick = async (node: TreeNode, trail: TreeNode[]): Promise<void> => {
    try {
      // The method's own options are where its name and signature live, which is what a reference to it
      // is made of; the type the picker found it under comes from the trail.
      const response = await window.dnSpy.getNodeOptions(workspaceId, 'method', { nodeId: node.id })
      const reference = response.method ? pickedMethodRef(trail, response.method) : undefined
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
