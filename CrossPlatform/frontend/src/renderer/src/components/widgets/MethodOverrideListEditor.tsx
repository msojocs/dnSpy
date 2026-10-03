import { useLanguage } from '../../localization'
import { ListEditor, type ListEditorItemProps, useRowComponent } from '../ListEditor'
import { MethodOverrideDialog } from './MethodOverrideDialog'
import { methodOverrideLabel, type MethodOverrideDraft, newMethodOverride } from './method-override'

interface MethodOverrideListEditorProps {
  workspaceId: string
  /** The overrides the method carries. They are drafts because a row being added has no declaration
   * yet; the method dialog converts them to and from what the backend takes. */
  items: MethodOverrideDraft[]
  onChange(items: MethodOverrideDraft[]): void
  disabled?: boolean
  ariaLabel?: string
}

/**
 * A list of explicit overrides — dnSpy's `MethodOverridesVM`, whose rows are named by the method they
 * declare and whose Add... goes straight to the method picker.
 */
export const MethodOverrideListEditor = ({ workspaceId, items, onChange, disabled = false, ariaLabel }: MethodOverrideListEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const ItemDialog = useRowComponent(
    () => (props: ListEditorItemProps<MethodOverrideDraft>) => <MethodOverrideDialog workspaceId={workspaceId} {...props} />,
    [workspaceId],
  )
  return (
    <ListEditor
      items={items}
      onChange={onChange}
      label={methodOverrideLabel}
      create={newMethodOverride}
      itemDialog={ItemDialog}
      disabled={disabled}
      ariaLabel={ariaLabel ?? t('Method Overrides')}
    />
  )
}
