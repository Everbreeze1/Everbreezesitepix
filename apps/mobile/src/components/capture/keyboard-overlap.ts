import { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, Platform, type KeyboardEvent, type View } from "react-native";
import { keyboardOverlap } from "./note-editor-layout";

type Frame = { top: number; height: number };

/**
 * The keyboard's overlap of one view, kept current as the keyboard opens,
 * changes height (the dictation panel is taller than the letters) and closes,
 * and as the view itself is laid out again (a rotation, or a window that
 * resized for the keyboard after all). Built on React Native's own keyboard
 * events, so it needs no extra package and works on iOS and Android alike.
 *
 * `visible` is true whenever the keyboard is up, even when it covers none of
 * the view (a window that resized for it), so the editor can still fold.
 *
 * Attach `ref` and `onLayout` to the view that must stay clear of the
 * keyboard, then pad its bottom by `overlap`.
 */
export function useKeyboardOverlap() {
  const ref = useRef<View>(null);
  const frame = useRef<Frame | null>(null);
  const [overlap, setOverlap] = useState(0);
  const [visible, setVisible] = useState(false);

  const measure = useCallback(() => {
    const kb = frame.current;
    if (!kb) {
      setOverlap(0);
      return;
    }
    const node = ref.current;
    const windowHeight = Dimensions.get("window").height;
    if (!node) {
      setOverlap(
        keyboardOverlap({
          viewBottom: windowHeight,
          keyboardTop: kb.top,
          keyboardHeight: kb.height,
          windowHeight,
        }),
      );
      return;
    }
    node.measureInWindow((_x, y, _w, h) => {
      const current = frame.current;
      if (!current) return;
      setOverlap(
        keyboardOverlap({
          viewBottom: y + h,
          keyboardTop: current.top,
          keyboardHeight: current.height,
          windowHeight,
        }),
      );
    });
  }, []);

  useEffect(() => {
    const ios = Platform.OS === "ios";
    const onShow = (event: KeyboardEvent) => {
      frame.current = {
        top: event.endCoordinates.screenY,
        height: event.endCoordinates.height,
      };
      setVisible(true);
      measure();
    };
    const onHide = () => {
      frame.current = null;
      setVisible(false);
      setOverlap(0);
    };
    /* The dictation panel is a different height from the letters. */
    const onChange = (event: KeyboardEvent) => {
      if (frame.current) onShow(event);
    };
    const subs = [
      Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", onShow),
      Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", onHide),
      Keyboard.addListener(ios ? "keyboardWillChangeFrame" : "keyboardDidChangeFrame", onChange),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, [measure]);

  /*
   * A padded view changes its own layout, so only the outer, unpadded view
   * should carry this; its size does not change when its padding does.
   */
  const onLayout = useCallback(() => {
    if (frame.current) measure();
  }, [measure]);

  return { ref, onLayout, overlap, visible };
}
