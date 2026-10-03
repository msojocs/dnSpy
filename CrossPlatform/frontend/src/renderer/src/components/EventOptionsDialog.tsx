import { useState } from 'react'
import type { AccessorRefDto, EventOptionsDto } from '../../../shared/protocol'
import { useLanguage } from '../localization'
import { OptionsShell } from './OptionsShell'
import { accessorRefLabel, type AccessorRefRow } from './widgets/accessor-ref'
import { AccessorRefListEditor } from './widgets/AccessorRefListEditor'
import { AccessorRefPickerDialog } from './widgets/AccessorRefPickerDialog'
import { CustomAttributeListEditor } from './widgets/CustomAttributeListEditor'
import { eventOptionsDraft, eventOptionsDto, EVENT_FLAGS, hasEventFlag, withEventFlag, type EventOptionsDraft } from './widgets/event-options'
import { TypeSigEditor, type TypeSigEditorOptions } from './widgets/TypeSigEditor'

interface EventOptionsDialogProps {
  workspaceId: string
  /** The model the dialog opens with: what the event holds, or the defaults a new one starts from. */
  value: EventOptionsDto
  isNew: boolean
  /** Why the backend refused the last attempt to write this model. The window keeps the model, so the
   * reason goes beside it rather than replacing it. */
  failure?: string
  onAccept(options: EventOptionsDto): void
  onCancel(): void
}

/** The three methods an event is made of, in the order the XAML lays their rows out. */
const ACCESSOR_ROWS = [
  { key: 'addMethod', label: 'Add...' },
  { key: 'invokeMethod', label: 'Invoke...' },
  { key: 'removeMethod', label: 'Remove...' },
] as const

/**
 * dnSpy's `EventOptionsDlg`: the five pages of the event editor on one window, which is the same window
 * for creating and editing — only the title and the model it starts with differ.
 *
 * The Methods page is not a list like the property's accessor pages. An event has exactly one of each
 * kind, so each row is a button that opens the method picker, the clear button beside it — dnSpy's "C",
 * which sets the method to null — and a read-only box showing the full name the picker returned.
 */
export const EventOptionsDialog = ({ workspaceId, value, isNew, failure, onAccept, onCancel }: EventOptionsDialogProps): React.JSX.Element => {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<EventOptionsDraft>(() => eventOptionsDraft(value))
  const [picking, setPicking] = useState<'addMethod' | 'invokeMethod' | 'removeMethod'>()

  /**
   * What the event type's editor may hold, which is dnSpy's `TypeSigCreatorOptions` for this dialog: the
   * owner type's generic parameters when it has any, method generic parameters, and no function pointers.
   */
  const signatureOptions: TypeSigEditorOptions = {
    canAddGenericTypeVar: (value.ownerGenericParameterCount ?? 0) > 0,
    canAddGenericMethodVar: true,
    canAddFnPtr: false,
    isLocal: false,
  }

  const edit = (patch: Partial<EventOptionsDraft>): void => { setDraft({ ...draft, ...patch }) }

  /** The method a row writes back, as the one field of the draft it belongs to — spelled out rather than
   * computed, since a computed key would have to be cast back to the draft's shape to be assignable. */
  const accessorPatch = (key: 'addMethod' | 'invokeMethod' | 'removeMethod', method: AccessorRefRow): Partial<EventOptionsDraft> =>
    key === 'addMethod' ? { addMethod: method } : key === 'invokeMethod' ? { invokeMethod: method } : { removeMethod: method }

  /** One of the three methods the event is made of: the picker, the clear button, and what was picked. */
  const accessorRow = (key: 'addMethod' | 'invokeMethod' | 'removeMethod', label: string): React.JSX.Element => {
    const method = draft[key]
    return (
      <div className="event-method">
        <button type="button" onClick={() => { setPicking(key) }}>{t(label)}</button>
        {/* dnSpy's clear button is the letter C with "Set to null" as its tooltip. */}
        <button type="button" disabled={method === undefined} title={t('Set to null')} aria-label={`${t('Set to null')}: ${t(label)}`} onClick={() => { edit(accessorPatch(key, undefined)) }}>C</button>
        <input readOnly value={accessorRefLabel(method)} title={accessorRefLabel(method)} aria-label={`${t(label)} method`} />
      </div>
    )
  }

  return (
    <OptionsShell
      title={isNew ? 'Create Event' : 'Edit Event'}
      className="event-options"
      tabs={[
        {
          label: 'Main',
          content: (
            <div className="options-page">
              <label className="options-name">
                <span className="options-row-label">{t('Name')}</span>
                <input aria-label={t('Name')} value={draft.name} onChange={(event) => { edit({ name: event.target.value }) }} />
              </label>

              <fieldset className="ca-group">
                <legend>{t('Flags')}</legend>
                <div className="options-flags-two">
                  {EVENT_FLAGS.map((entry) => (
                    <label className="options-row" key={entry.label}>
                      <input
                        type="checkbox"
                        checked={hasEventFlag(draft.attributes, entry.flag)}
                        onChange={(event) => { edit({ attributes: withEventFlag(draft.attributes, entry.flag, event.target.checked) }) }}
                      />
                      {entry.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          ),
        },
        {
          label: 'Type',
          content: (
            <TypeSigEditor
              workspaceId={workspaceId}
              value={draft.eventType?.kind === 'empty' ? null : draft.eventType ?? null}
              onChange={(eventType) => { edit({ eventType: eventType ?? undefined }) }}
              options={signatureOptions}
            />
          ),
        },
        {
          label: 'Methods',
          content: (
            <div className="event-methods">
              {ACCESSOR_ROWS.map((row) => <div key={row.key}>{accessorRow(row.key, row.label)}</div>)}
              {picking !== undefined && (
                <AccessorRefPickerDialog
                  workspaceId={workspaceId}
                  value={draft[picking]}
                  isNew={draft[picking] === undefined}
                  onAccept={(method: AccessorRefDto | undefined) => { edit(accessorPatch(picking, method)); setPicking(undefined) }}
                  onCancel={() => { setPicking(undefined) }}
                />
              )}
            </div>
          ),
        },
        {
          label: 'Other Methods',
          content: (
            <AccessorRefListEditor
              workspaceId={workspaceId}
              items={draft.otherMethods}
              onChange={(otherMethods) => { edit({ otherMethods }) }}
              ariaLabel={t('Other Methods')}
            />
          ),
        },
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
      error={failure}
      onReset={() => { setDraft(eventOptionsDraft(value)) }}
      onAccept={() => { onAccept(eventOptionsDto(draft)) }}
      onClose={onCancel}
    />
  )
}
