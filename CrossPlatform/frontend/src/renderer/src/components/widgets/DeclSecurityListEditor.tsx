import { useLanguage } from '../../localization'
import { ListEditor, type ListEditorItemProps, useRowComponent } from '../ListEditor'
import { DeclSecurityDialog } from './DeclSecurityDialog'
import { declSecurityLabel, newDeclSecurity, type DeclSecurityDraft } from './decl-security'

interface DeclSecurityListEditorProps {
  workspaceId: string
  /** The declarative security rows a type or method carries. They are drafts because a row's version is
   * a state of the dialog; the owner dialog converts them to and from what the backend takes. */
  items: DeclSecurityDraft[]
  onChange(items: DeclSecurityDraft[]): void
  disabled?: boolean
  ariaLabel?: string
}

/**
 * A list of declarative security rows — dnSpy's `DeclSecuritiesVM`, whose rows are edited through
 * `DeclSecurityDlg` and shown as the action each one demands. A new row goes at the end, which is the
 * base `ListVM.GetAddIndex` that this list does not override.
 */
export const DeclSecurityListEditor = ({ workspaceId, items, onChange, disabled = false, ariaLabel }: DeclSecurityListEditorProps): React.JSX.Element => {
  const { t } = useLanguage()
  const ItemDialog = useRowComponent(
    () => (props: ListEditorItemProps<DeclSecurityDraft>) => <DeclSecurityDialog workspaceId={workspaceId} {...props} />,
    [workspaceId],
  )
  return (
    <ListEditor
      items={items}
      onChange={onChange}
      label={declSecurityLabel}
      create={newDeclSecurity}
      itemDialog={ItemDialog}
      disabled={disabled}
      ariaLabel={ariaLabel ?? t('Security Declarations')}
    />
  )
}
