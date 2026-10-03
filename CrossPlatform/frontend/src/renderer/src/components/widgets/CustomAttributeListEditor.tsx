import { useLanguage } from '../../localization'
import { ListEditor, type ListEditorItemProps, useRowComponent } from '../ListEditor'
import { CustomAttributeDialog } from './CustomAttributeDialog'
import { customAttributeLabel, type CustomAttributeDraft, newCustomAttribute } from './custom-attribute'

interface CustomAttributeListEditorProps {
  workspaceId: string
  /** The attributes the owner carries. They are drafts because a row being added has no constructor yet;
   * the owner converts them to and from what the backend takes. */
  items: CustomAttributeDraft[]
  onChange(items: CustomAttributeDraft[]): void
  disabled?: boolean
  ariaLabel?: string
}

/**
 * A list of custom attributes — dnSpy's `CustomAttributesVM`, which is a `ListVM` edited through
 * `CustomAttributeDlg` and shown as what each attribute sets, `FullName`'s text.
 */
export const CustomAttributeListEditor = ({ workspaceId, items, onChange, disabled = false, ariaLabel }: CustomAttributeListEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const ItemDialog = useRowComponent(
    () => (props: ListEditorItemProps<CustomAttributeDraft>) => <CustomAttributeDialog workspaceId={workspaceId} {...props} />,
    [workspaceId],
  )
  return (
    <ListEditor
      items={items}
      onChange={onChange}
      label={customAttributeLabel}
      create={newCustomAttribute}
      itemDialog={ItemDialog}
      disabled={disabled}
      ariaLabel={ariaLabel ?? t('Custom Attributes')}
    />
  )
}
