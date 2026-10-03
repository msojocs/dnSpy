import { useMemo } from 'react'
import type { MethodRefDto } from '../../../../shared/protocol'
import { useLanguage } from '../../localization'
import { ListEditor, type ListEditorItemProps, useRowComponent } from '../ListEditor'
import { methodRefRowLabel, type MethodRefRow } from './method-ref'
import { MethodRefPickerDialog } from './MethodRefPickerDialog'

interface MethodDefsListEditorProps {
  workspaceId: string
  /** The methods a property or an event uses — its accessors, dnSpy's `GetMethodsVM` / `SetMethodsVM` /
   * `OtherMethodsVM` and the event's three, all of which are the same list of methods. */
  items: MethodRefDto[]
  onChange(items: MethodRefDto[]): void
  /** The module the methods have to come from, which is dnSpy's `SameModuleDocumentTreeNodeFilter` on
   * the picker: an accessor is a `MethodSemantics` row, and those can only point inside the module. */
  rootNodeIds?: string[]
  disabled?: boolean
  ariaLabel?: string
}

/**
 * A list of the methods a property or an event is made of — dnSpy's `MethodDefsVM`, whose rows are
 * picked rather than built: there is no method dialog behind them, only the method picker, and the row
 * goes into the list as whatever it returned. A row of nothing is what Add... opens the picker on —
 * `MethodDefVM(null)`, the row `Verify` refuses as "Method can't be null" — and it only reaches the list
 * once a method has been picked, so it lives for as long as the picker that was opened on it.
 */
export const MethodDefsListEditor = ({ workspaceId, items, onChange, rootNodeIds, disabled = false, ariaLabel }: MethodDefsListEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  // The ids reach the picker as the one array a row's dialog was built with, so a caller writing them
  // inline must not hand a new array to every render — that would rebuild the dialog and fold the tree
  // the user has open. Their contents are what the dialog is built on, not their identity.
  const rootKey = rootNodeIds === undefined ? undefined : rootNodeIds.join('\n')
  const roots = useMemo(() => (rootKey === undefined ? undefined : rootKey.split('\n')), [rootKey])
  const ItemDialog = useRowComponent(
    () => (props: ListEditorItemProps<MethodRefRow>) => (
      <MethodRefPickerDialog workspaceId={workspaceId} rootNodeIds={roots} {...props} />
    ),
    [workspaceId, roots],
  )
  return (
    <ListEditor
      items={items}
      onChange={(rows) => { onChange(rows.filter((row): row is MethodRefDto => row !== undefined)) }}
      label={methodRefRowLabel}
      create={() => undefined}
      itemDialog={ItemDialog}
      disabled={disabled}
      ariaLabel={ariaLabel ?? t('Methods')}
    />
  )
}
