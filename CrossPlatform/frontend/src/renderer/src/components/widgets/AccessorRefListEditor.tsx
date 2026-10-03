import { useMemo } from 'react'
import type { AccessorRefDto } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import { ListEditor, type ListEditorItemProps, useRowComponent } from '../ListEditor'
import { accessorRefLabel, type AccessorRefRow } from './accessor-ref'
import { AccessorRefPickerDialog } from './AccessorRefPickerDialog'

interface AccessorRefListEditorProps {
  workspaceId: string
  /** The methods this list is made of — dnSpy's `GetMethodsVM` / `SetMethodsVM` / `OtherMethodsVM`, which
   * are the same `MethodDefsVM` three times over. */
  items: AccessorRefRow[]
  onChange(items: AccessorRefRow[]): void
  /** The nodes the picker may look under, which is dnSpy's `SameModuleDocumentTreeNodeFilter` on it. */
  rootNodeIds?: string[]
  disabled?: boolean
  ariaLabel?: string
}

/**
 * A list of the methods a property is made of — dnSpy's `MethodDefsVM`, whose rows are picked rather
 * than built: there is no method dialog behind them, only the method picker, and the row goes into the
 * list as whatever it returned. A row of nothing is what Add... opens the picker on — `MethodDefVM(null)`,
 * the row `Verify` refuses as "Method can't be null" — and it only reaches the list once a method has
 * been picked, so it lives for as long as the picker that was opened on it.
 */
export const AccessorRefListEditor = ({ workspaceId, items, onChange, rootNodeIds, disabled = false, ariaLabel }: AccessorRefListEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  // The ids reach the picker as the one array a row's dialog was built with, so a caller writing them
  // inline must not hand a new array to every render — that would rebuild the dialog and fold the tree
  // the user has open. Their contents are what the dialog is built on, not their identity.
  const rootKey = rootNodeIds === undefined ? undefined : rootNodeIds.join('\n')
  const roots = useMemo(() => (rootKey === undefined ? undefined : rootKey.split('\n')), [rootKey])
  const ItemDialog = useRowComponent(
    () => (props: ListEditorItemProps<AccessorRefRow>) => (
      <AccessorRefPickerDialog workspaceId={workspaceId} rootNodeIds={roots} {...props} />
    ),
    [workspaceId, roots],
  )
  return (
    <ListEditor
      items={items}
      onChange={(rows) => { onChange(rows.filter((row): row is AccessorRefDto => row !== undefined)) }}
      label={accessorRefLabel}
      create={() => undefined}
      itemDialog={ItemDialog}
      disabled={disabled}
      ariaLabel={ariaLabel ?? t('Methods')}
    />
  )
}
