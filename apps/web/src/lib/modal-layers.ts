/**
 * Modals stacked on modals.
 *
 * A confirmation raised from inside a dialog is not a child of that dialog: the
 * ConfirmDialogProvider renders it at the root, so the two are SIBLING layers in
 * the DOM. Radix decides "did the user interact outside me?" by asking whether
 * the event target is contained in its own content, and the answer for a click
 * on the confirmation's Cancel button is no - so the dialog underneath treats it
 * as a click on the page and dismisses itself.
 *
 * Found by driving the browser: a manager who declined "complete this for
 * Jackson?" lost the entire task they were editing, which is a worse outcome
 * than the missing warning that work set out to add. It is not specific to
 * tasks - it is true of any dialog that asks the user to confirm something, so
 * the guard lives on the shared primitives rather than being remembered at each
 * call site.
 *
 * Why the DOM and not React state: the dismissal and the confirmation's own
 * close land on the same pointerdown, and by the time the close is processed the
 * confirmation has unmounted, so any `isConfirmOpen` flag reads back false. The
 * element under the pointer is still true at the instant it is asked.
 */

/** Radix's outside-interaction events, which carry the real event in `detail`. */
type OutsideEvent = {
  target: EventTarget | null;
  detail?: { originalEvent?: Event };
  preventDefault: () => void;
};

/**
 * True when this interaction happened inside a confirmation sitting above the
 * layer being asked, rather than out on the page.
 */
export function isInteractionInsideConfirmation(e: OutsideEvent): boolean {
  const target = (e.detail?.originalEvent?.target ?? e.target) as HTMLElement | null;
  if (!target?.closest) return false;
  return target.closest('[role="alertdialog"]') !== null;
}

/**
 * Dismissal handler for a modal layer: answering a confirmation above it is not
 * an interaction with the page behind it, so the layer stays open.
 *
 * Composed into `DialogContent` and `SheetContent`, ahead of any handler the
 * caller passes, so an individual screen gets this without opting in.
 */
export function keepOpenUnderConfirmation<E extends OutsideEvent>(
  handler?: (event: E) => void,
): (event: E) => void {
  return (event) => {
    if (isInteractionInsideConfirmation(event)) event.preventDefault();
    handler?.(event);
  };
}

/**
 * Is a confirmation on screen right now?
 *
 * For layers that are not Radix dismissable layers and so get no
 * outside-interaction callback to guard - the photo lightbox is a hand-rolled
 * portal listening for Escape on the window, which means the Escape that
 * dismisses a confirmation raised inside it also closes the lightbox behind it.
 * Asked of the DOM for the same reason as the guard above.
 */
export function confirmationIsOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[role="alertdialog"]') !== null;
}

/**
 * Is anything modal on screen - a dialog, a sheet, the photo lightbox, a
 * confirmation?
 *
 * For page-level Escape shortcuts, which are the bottom of the stack and must
 * not act on a key that belongs to a layer above them. The Gallery's grid
 * selection is the case this exists for: Escape out of the bulk Tag dialog, or
 * out of the lightbox opened from a ticked photo, and the same press reached
 * the page underneath and threw the selection away - so backing out of one step
 * silently cost you the run of photos you had just picked.
 *
 * Asked of the DOM rather than tracked in state, for the reason at the top of
 * this file: the layer above may already be unmounting when the page's own
 * handler runs, and any React flag would read back stale.
 */
export function modalLayerIsOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * Run `handler` on Escape, but only when no modal layer owns that press.
 *
 * The phase is the whole point, and the reason this is a helper rather than
 * three lines at each call site.
 *
 * `modalLayerIsOpen()` asks the DOM what is open RIGHT NOW. Radix's
 * DismissableLayer listens for Escape on the document in the bubble phase and
 * takes its content out of the DOM there, so a page-level listener that also
 * bubbles is asking the question after the answer has already changed: it sees
 * no dialog, concludes the press was meant for the page, and clears the
 * selection that the user was still working on. Escape out of the bulk Share
 * dialog and your ticked photos went with it, while closing the same dialog by
 * its X button left them alone - which is exactly how it behaved in both the
 * Gallery and the project grid until this was measured in a browser.
 *
 * Capture on `window` is the earliest point in the event's path, before any
 * layer has had a chance to unmount, so the question is asked while the answer
 * is still true.
 *
 * @returns the unsubscribe, for an effect cleanup.
 */
export function onEscapeOutsideModals(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (modalLayerIsOpen()) return;
    handler();
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}
