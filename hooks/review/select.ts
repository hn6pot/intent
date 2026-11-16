// Which folder the pane shows when the person has not chosen: one with a review, the session's own first; a PR only when chosen.
import type { Slot } from '../model'
import { isDormant, isFolder } from './slots'

const shown = (slot: Slot): boolean => !isDormant(slot) && !slot.gone
const pickable = (slot: Slot): boolean => shown(slot) && isFolder(slot)
const reviewed = (slot: Slot): boolean => pickable(slot) && !slot.empty && slot.review !== null

export function autoSelect(slots: readonly Slot[], current: string | null, chosen: boolean, cwd: string | null): string | null {
  const stillShown = slots.some(s => s.root === current && shown(s))
  if (chosen && stillShown) return current
  const withReview = slots.filter(reviewed)
  if (withReview.some(s => s.root === current)) return current
  const pick =
    withReview.find(s => s.root === cwd) ??
    withReview[0] ??
    slots.find(s => pickable(s) && s.root === cwd) ??
    slots.find(s => pickable(s) && s.root === current) ??
    slots.find(pickable)
  return pick?.root ?? null
}
