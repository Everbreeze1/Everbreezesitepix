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
