/**
 * The lucide icons the web annotator's toolbar uses, deep-imported one file at
 * a time for the same reason `src/ui/icons.ts` does it: the package barrel
 * would pull all ~1600 icons into the bundle. Kept beside the annotator so its
 * icon set reads as one list and matches web's import line for line.
 *
 * Web names: Undo2, Redo2, Ruler, Circle, Square, Type, Clock, Smile, Palette,
 * Sliders (lucide's alias of SlidersVertical), RotateCw, Trash2, Check, X,
 * Save, Copy.
 */
export { default as Check } from "lucide-react-native/dist/esm/icons/check";
export { default as CircleOutline } from "lucide-react-native/dist/esm/icons/circle";
export { default as Clock } from "lucide-react-native/dist/esm/icons/clock";
export { default as Copy } from "lucide-react-native/dist/esm/icons/copy";
export { default as Palette } from "lucide-react-native/dist/esm/icons/palette";
export { default as Redo2 } from "lucide-react-native/dist/esm/icons/redo-2";
export { default as RotateCw } from "lucide-react-native/dist/esm/icons/rotate-cw";
export { default as Ruler } from "lucide-react-native/dist/esm/icons/ruler";
export { default as Save } from "lucide-react-native/dist/esm/icons/save";
export { default as SlidersVertical } from "lucide-react-native/dist/esm/icons/sliders-vertical";
export { default as Smile } from "lucide-react-native/dist/esm/icons/smile";
export { default as Square } from "lucide-react-native/dist/esm/icons/square";
export { default as Trash2 } from "lucide-react-native/dist/esm/icons/trash-2";
export { default as Type } from "lucide-react-native/dist/esm/icons/type";
export { default as Undo2 } from "lucide-react-native/dist/esm/icons/undo-2";
export { default as X } from "lucide-react-native/dist/esm/icons/x";
