/**
 * The methods a property or an event is made of, as the dialogs that own them hold them.
 *
 * A reference carries the node id of the row the user picked and the method's full name, which is what
 * both sides need: the id is how the backend finds the method again — it is preferred over the token,
 * since the row it names is exactly the one that was picked — and the full name is what the row and the
 * event's read-only boxes show, in the same text dnlib writes for a method.
 */

import type { AccessorRefDto, MethodOptionsDto, TreeNode } from '../../../../shared/protocol'
import { methodRefFullName, pickedMethodRef } from './method-ref'

/**
 * A row of an accessor list, which is dnSpy's `MethodDefVM`: a row with nothing in it is what Add...
 * opens the picker on, and it is what `MethodDefVM.FullName` calls "null". It reaches the list only once
 * a method has been picked.
 */
export type AccessorRefRow = AccessorRefDto | undefined

/** How an accessor row reads: dnSpy's `MethodDefVM.FullName`, down to what it says for an empty row. */
export const accessorRefLabel = (row: AccessorRefRow): string => row === undefined ? 'null' : row.display || row.name

/** The reference a just-picked method makes: the node that was picked, and the full name the backend
 * would have put in `display` had it read the row itself. */
export const pickedAccessorRef = (trail: TreeNode[], nodeId: string, method: MethodOptionsDto): AccessorRefDto | undefined => {
  const reference = pickedMethodRef(trail, method)
  return reference === undefined ? undefined : { name: reference.name, nodeId, display: methodRefFullName(reference) }
}
