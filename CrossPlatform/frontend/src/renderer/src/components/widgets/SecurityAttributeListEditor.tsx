import { useLanguage } from '../../localization'
import { ListEditor, type ListEditorItemProps, useRowComponent } from '../ListEditor'
import { SecurityAttributeDialog } from './SecurityAttributeDialog'
import { newSecurityAttribute, securityAttributeLabel, type SecurityAttributeDraft } from './security-attribute'

interface SecurityAttributeListEditorProps {
  workspaceId: string
  /** The security attributes a declarative security row demands. They are drafts because a row's type
   * is picked rather than carried; the row dialog converts them to and from what the backend takes. */
  items: SecurityAttributeDraft[]
  onChange(items: SecurityAttributeDraft[]): void
  disabled?: boolean
  ariaLabel?: string
}

/**
 * A list of security attribute rows — dnSpy's `SecurityAttributesVM`, whose rows are edited through
 * `SecurityAttributeDlg` and shown as what each one demands. A new row goes at the end, which is the
 * base `ListVM.GetAddIndex` that this list does not override.
 */
export const SecurityAttributeListEditor = ({ workspaceId, items, onChange, disabled = false, ariaLabel }: SecurityAttributeListEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const ItemDialog = useRowComponent(
    () => (props: ListEditorItemProps<SecurityAttributeDraft>) => <SecurityAttributeDialog workspaceId={workspaceId} {...props} />,
    [workspaceId],
  )
  return (
    <ListEditor
      items={items}
      onChange={onChange}
      label={securityAttributeLabel}
      create={newSecurityAttribute}
      itemDialog={ItemDialog}
      disabled={disabled}
      ariaLabel={ariaLabel ?? t('Security Attributes')}
    />
  )
}
