import { useState } from 'react'
import { useLanguage } from '../../localization'
import type { ListEditorItemProps } from '../ListEditor'
import { OptionsShell } from '../OptionsShell'
import { CustomAttributeListEditor } from './CustomAttributeListEditor'
import {
  DECL_SEC_V1, DECL_SEC_VERSIONS, declSecurityError, SECURITY_ACTIONS, type DeclSecurityDraft,
} from './decl-security'
import { SecurityAttributeListEditor } from './SecurityAttributeListEditor'

interface DeclSecurityDialogProps extends ListEditorItemProps<DeclSecurityDraft> {
  workspaceId: string
}

/**
 * dnSpy's `DeclSecurityDlg`: one window for Create and Edit, whose two pages are the demand itself and
 * the custom attributes on it.
 *
 * The row is in one of two forms and the version box is what picks between them, which is dnSpy's own
 * `DeclSecVer`: the .NET 1.x XML blob older compilers wrote, or the list of security attributes that
 * replaced it. Only the page the row is in is drawn, and the other keeps what it holds while the combo
 * is on it — as dnSpy's two grids do, since both live in the view model at once.
 */
export const DeclSecurityDialog = ({ workspaceId, value, isNew, onAccept, onCancel }: DeclSecurityDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  // The row's own value is already a draft, and it is never written into — every edit replaces it.
  const [draft, setDraft] = useState<DeclSecurityDraft>(value)
  const error = declSecurityError(draft)
  const edit = (patch: Partial<DeclSecurityDraft>): void => { setDraft({ ...draft, ...patch }) }
  const isV1 = draft.version === DECL_SEC_V1

  const main = (
    <div className="decl-security">
      <div className="decl-security-head">
        <select
          aria-label={t('Action')}
          value={draft.action}
          onChange={(event) => { edit({ action: Number(event.target.value) }) }}
        >
          {SECURITY_ACTIONS.map((entry) => <option key={entry.label} value={entry.value}>{entry.label}</option>)}
        </select>
        {/* The version box is dnSpy's own 30-pixel-wide combo, which is why its labels are two letters. */}
        <select
          aria-label={t('Version')}
          value={draft.version}
          onChange={(event) => { edit({ version: Number(event.target.value) }) }}
        >
          {DECL_SEC_VERSIONS.map((entry) => <option key={entry.label} value={entry.value}>{entry.label}</option>)}
        </select>
      </div>

      {isV1
        ? (
          <div className="decl-security-xml">
            <label htmlFor="decl-security-xml">{t('XML')}</label>
            <textarea
              id="decl-security-xml"
              aria-label={t('XML')}
              value={draft.xml}
              onChange={(event) => { edit({ xml: event.target.value }) }}
            />
          </div>
        )
        : (
          <SecurityAttributeListEditor
            workspaceId={workspaceId}
            items={draft.securityAttributes}
            onChange={(securityAttributes) => { edit({ securityAttributes }) }}
          />
        )}
    </div>
  )

  return (
    <OptionsShell
      title={isNew ? 'Create Security Declaration' : 'Edit Security Declaration'}
      tabs={[
        { label: 'Main', content: main },
        {
          label: 'Custom Attrs',
          content: (
            <CustomAttributeListEditor
              workspaceId={workspaceId}
              items={draft.customAttributes}
              onChange={(customAttributes) => { edit({ customAttributes }) }}
            />
          ),
        },
      ]}
      invalid={error !== undefined}
      error={error === undefined ? undefined : t(error.template, error.args)}
      onReset={() => { setDraft(value) }}
      onAccept={() => { onAccept(draft) }}
      onClose={onCancel}
    />
  )
}
