import { useEffect, useState } from 'react'
import type { NodeOptionsDto } from '../../../shared/protocol'
import { useAppStore } from '../app-store'
import { useLanguage } from '../localization'
import { FieldOptionsDialog } from './FieldOptionsDialog'
import { MethodOptionsDialog } from './MethodOptionsDialog'
import { OptionsShell } from './OptionsShell'
import type { CreatedKind } from './edit-menu'

interface NodeOptionsDialogProps {
  workspaceId: string
  /** Which create or edit command opened it, and so which model is fetched and which window is shown. */
  kind: CreatedKind
  /** The node being edited. Left off when a new one is being created, which is what the title says. */
  nodeId?: string
  /** The node a new one is added to — the type the selection belongs to. */
  ownerNodeId?: string
  onClose(): void
}

/** The two titles dnSpy's commands give each of these windows; the dialog itself is the same one. */
const TITLES: Record<CreatedKind, { create: string, edit: string }> = {
  type: { create: 'Create Type', edit: 'Edit Type' },
  method: { create: 'Create Method', edit: 'Edit Method' },
  field: { create: 'Create Field', edit: 'Edit Field' },
  property: { create: 'Create Property', edit: 'Edit Property' },
  event: { create: 'Create Event', edit: 'Edit Event' },
}

/**
 * The create and edit commands behind the Edit menu, for every kind that has a dialog: the model is read
 * from the backend — what the node holds, or the defaults a new one starts from, which the backend settles
 * the way dnSpy's create commands do — and whatever the dialog accepts is written back through the edit
 * transaction, so it lands in the undo history like any other edit.
 *
 * A write the backend refuses leaves the window where it is, with the reason on it: the model the user
 * built is still there to fix, and the store has already put the message in its own error strip.
 */
export const NodeOptionsDialog = ({ workspaceId, kind, nodeId, ownerNodeId, onClose }: NodeOptionsDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  const createNode = useAppStore((state) => state.createNode)
  const applyNodeOptions = useAppStore((state) => state.applyNodeOptions)
  const [options, setOptions] = useState<NodeOptionsDto>()
  // Two different failures, told apart because they are answered differently: a model that never arrived
  // leaves nothing to edit, while a refused write leaves the whole model in the window.
  const [loadFailure, setLoadFailure] = useState<string>()
  const [writeFailure, setWriteFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  const isNew = nodeId === undefined
  const title = isNew ? TITLES[kind].create : TITLES[kind].edit

  useEffect(() => {
    let cancelled = false
    void window.dnSpy.getNodeOptions(workspaceId, kind, isNew ? { ownerNodeId, isNew: true } : { nodeId })
      .then((response) => { if (!cancelled) setOptions(response) })
      .catch((reason: unknown) => { if (!cancelled) setLoadFailure(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [workspaceId, kind, nodeId, ownerNodeId, isNew])

  const accept = async (next: NodeOptionsDto): Promise<void> => {
    setBusy(true)
    setWriteFailure(undefined)
    const written = isNew ? await createNode(ownerNodeId ?? '', next) : await applyNodeOptions(nodeId ?? '', next)
    setBusy(false)
    if (written)
      onClose()
    else
      setWriteFailure(useAppStore.getState().error)
  }

  // A window with nothing to edit in it, for a model that never arrived and for a kind whose dialog has
  // not been built yet; either way the only thing to do with it is close it.
  const nothing = (reason: string): React.JSX.Element => (
    <OptionsShell
      title={title}
      hideTabStrip
      tabs={[{ label: title, content: <div className="options-error">{reason}</div> }]}
      invalid
      onAccept={onClose}
      onClose={onClose}
    />
  )

  if (loadFailure !== undefined)
    return nothing(loadFailure)
  if (options === undefined)
    return nothing(t('Loading...'))

  // One window per kind, and a kind whose dialog the port has not built yet has nothing to show.
  const dialog = (): React.JSX.Element | undefined => {
    switch (kind) {
      case 'method':
        return options.method === undefined ? undefined : (
          <MethodOptionsDialog
            workspaceId={workspaceId}
            value={options.method}
            isNew={isNew}
            failure={writeFailure}
            onAccept={(method) => { void accept({ kind, method }) }}
            onCancel={onClose}
          />
        )
      case 'field':
        return options.field === undefined ? undefined : (
          <FieldOptionsDialog
            workspaceId={workspaceId}
            value={options.field}
            isNew={isNew}
            failure={writeFailure}
            onAccept={(field) => { void accept({ kind, field }) }}
            onCancel={onClose}
          />
        )
      default:
        return undefined
    }
  }

  return dialog() ?? nothing(t('The item cannot be edited.'))
}
