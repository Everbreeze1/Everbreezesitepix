/**
 * The app's icon set, imported one file at a time.
 *
 * Importing from the `lucide-react-native` barrel is what you would write, and
 * it costs 2.5MB. Metro does not tree-shake, so `import { Camera } from
 * "lucide-react-native"` pulls the module that re-exports all ~1600 icons, and
 * every one of them lands in the Hermes bundle. Measured on the Android export:
 * 3.7MB before, 6.2MB after, and a grep of the bundle finds `AlarmClockCheck`
 * and `CloudDrizzle` in an app that uses neither. On a phone, that is download
 * size, install size and cold-start parse time bought for nothing.
 *
 * Deep-importing each icon fixes it, but doing that at every call site is 29
 * unreadable paths sprinkled through the screens, and a path with a typo in it
 * fails at bundle time rather than in the editor. So it happens once, here, and
 * screens import from `@/ui/icons` exactly as they used to import from the
 * package.
 *
 * The per-icon files ship no types of their own, which is what
 * `src/types/lucide-icons.d.ts` is for.
 *
 * **Adding an icon:** find its kebab-case file name (`ClipboardCheck` is
 * `clipboard-check`), add a line below, and keep the list alphabetical. Do not
 * import from `lucide-react-native` directly in a screen: `tests/bundle-size`
 * has nothing to say about it, but the next Android export will be 2.5MB
 * heavier and nobody will know which commit did it.
 */

export { default as Activity } from "lucide-react-native/dist/esm/icons/activity";
export { default as Building2 } from "lucide-react-native/dist/esm/icons/building-2";
export { default as Camera } from "lucide-react-native/dist/esm/icons/camera";
export { default as ChevronRight } from "lucide-react-native/dist/esm/icons/chevron-right";
export { default as CircleCheck } from "lucide-react-native/dist/esm/icons/circle-check";
export { default as CircleQuestionMark } from "lucide-react-native/dist/esm/icons/circle-question-mark";
export { default as ClipboardCheck } from "lucide-react-native/dist/esm/icons/clipboard-check";
export { default as CloudUpload } from "lucide-react-native/dist/esm/icons/cloud-upload";
export { default as CreditCard } from "lucide-react-native/dist/esm/icons/credit-card";
export { default as ExternalLink } from "lucide-react-native/dist/esm/icons/external-link";
export { default as FileText } from "lucide-react-native/dist/esm/icons/file-text";
export { default as FolderKanban } from "lucide-react-native/dist/esm/icons/folder-kanban";
export { default as FolderPlus } from "lucide-react-native/dist/esm/icons/folder-plus";
export { default as ImageOff } from "lucide-react-native/dist/esm/icons/image-off";
export { default as Images } from "lucide-react-native/dist/esm/icons/images";
export { default as Inbox } from "lucide-react-native/dist/esm/icons/inbox";
export { default as LayoutTemplate } from "lucide-react-native/dist/esm/icons/layout-template";
export { default as LifeBuoy } from "lucide-react-native/dist/esm/icons/life-buoy";
export { default as ListTodo } from "lucide-react-native/dist/esm/icons/list-todo";
export { default as LocateFixed } from "lucide-react-native/dist/esm/icons/locate-fixed";
export { default as LogOut } from "lucide-react-native/dist/esm/icons/log-out";
export { default as MapPin } from "lucide-react-native/dist/esm/icons/map-pin";
export { default as MessageSquare } from "lucide-react-native/dist/esm/icons/message-square";
export { default as PenLine } from "lucide-react-native/dist/esm/icons/pen-line";
export { default as Plus } from "lucide-react-native/dist/esm/icons/plus";
export { default as RefreshCw } from "lucide-react-native/dist/esm/icons/refresh-cw";
export { default as Search } from "lucide-react-native/dist/esm/icons/search";
export { default as Send } from "lucide-react-native/dist/esm/icons/send";
export { default as Server } from "lucide-react-native/dist/esm/icons/server";
export { default as Trash2 } from "lucide-react-native/dist/esm/icons/trash-2";
export { default as Share2 } from "lucide-react-native/dist/esm/icons/share-2";
export { default as Star } from "lucide-react-native/dist/esm/icons/star";
export { default as TriangleAlert } from "lucide-react-native/dist/esm/icons/triangle-alert";
export { default as User } from "lucide-react-native/dist/esm/icons/user";
export { default as Users } from "lucide-react-native/dist/esm/icons/users";
export { default as Video } from "lucide-react-native/dist/esm/icons/video";
export { default as VideoOff } from "lucide-react-native/dist/esm/icons/video-off";
export { default as WifiOff } from "lucide-react-native/dist/esm/icons/wifi-off";
export { default as Workflow } from "lucide-react-native/dist/esm/icons/workflow";
export { default as X } from "lucide-react-native/dist/esm/icons/x";
