import { Component, useEffect, useState, useCallback, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Loader2,
  Maximize,
  Minimize,
  Share2,
} from "lucide-react";
import { cleanCaption, formatPhotoDate } from "@sitepix/shared";

export interface LightboxPhoto {
  id: string;
  url: string;
  caption?: string | null;
  takenAt?: string | null;
}

interface Props {
  photos: LightboxPhoto[];
  index: number;
  onClose: () => void;
  onIndexChange?: (i: number) => void;
  renderActions?: (photo: LightboxPhoto) => React.ReactNode;
  /** Right-side panel content (description, tasks, comments…). When provided,
   *  the lightbox goes edge-to-edge and the image takes the remaining space. */
  renderSidePanel?: (photo: LightboxPhoto) => React.ReactNode;
  /** Share handler - rendered as a dedicated toolbar icon. */
  onSharePhoto?: (photo: LightboxPhoto) => void;
}

class PhotoLightboxPanelBoundary extends Component<
  { photoId: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[photo-viewer] side panel failed", error, info);
  }

  componentDidUpdate(prevProps: { photoId: string }) {
    if (prevProps.photoId !== this.props.photoId && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-0 flex-col items-center justify-center p-6 text-center text-sidebar-foreground">
          <p className="text-sm font-semibold">Details couldn't load</p>
          <p className="mt-1 max-w-xs text-xs text-sidebar-foreground/55">
            The photo is still open. Close and reopen this panel, or try another photo.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

function SidePanelContent({
  photo,
  renderSidePanel,
}: {
  photo: LightboxPhoto;
  renderSidePanel: (photo: LightboxPhoto) => React.ReactNode;
}) {
  return <>{renderSidePanel(photo)}</>;
}

export function PhotoLightbox({
  photos,
  index,
  onClose,
  onIndexChange,
  renderActions,
  renderSidePanel,
  onSharePhoto,
}: Props) {
  const [current, setCurrent] = useState(index);
  const [loaded, setLoaded] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => setCurrent(index), [index]);
  useEffect(() => {
    setLoaded(false);
    setResetKey((k) => k + 1);
  }, [current]);

  const go = useCallback(
    (delta: number) => {
      setCurrent((c) => {
        const next = (c + delta + photos.length) % photos.length;
        onIndexChange?.(next);
        return next;
      });
    },
    [photos.length, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  if (typeof document === "undefined") return null;
  const photo = photos[current];
  if (!photo) return null;

  const hasSidePanel = !!renderSidePanel;
  const sidePanel = hasSidePanel ? (
    <PhotoLightboxPanelBoundary photoId={photo.id}>
      <SidePanelContent photo={photo} renderSidePanel={renderSidePanel!} />
    </PhotoLightboxPanelBoundary>
  ) : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex bg-black animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
    >
      {/* Main column: top bar + image + zoom */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-2 border-b border-sidebar-border bg-sidebar px-4 py-2.5 text-sidebar-foreground">
          <div className="min-w-0 flex-1 text-xs text-sidebar-foreground/70">
            {(() => {
              const clean = cleanCaption(photo.caption);
              const date = formatPhotoDate(photo.takenAt);
              return (
                <span className="truncate align-middle">
                  {clean ? (
                    <span className="mr-2 font-medium text-sidebar-foreground/90">{clean}</span>
                  ) : null}
                  {date && <span className="opacity-80">{date}</span>}
                  <span className="ml-2 opacity-70">
                    · {current + 1} / {photos.length}
                  </span>
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-2">
            {renderActions?.(photo)}
            {hasSidePanel && (
              <button
                type="button"
                aria-label={panelOpen ? "Enter full screen" : "Exit full screen"}
                title={panelOpen ? "Full screen" : "Exit full screen"}
                onClick={() => setPanelOpen((v) => !v)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-sidebar-foreground/10 text-sidebar-foreground transition hover:bg-sidebar-foreground/20"
              >
                {panelOpen ? <Maximize className="h-5 w-5" /> : <Minimize className="h-5 w-5" />}
              </button>
            )}
            {onSharePhoto && (
              <button
                type="button"
                aria-label="Share photo"
                title="Share"
                onClick={() => onSharePhoto(photo)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-sidebar-foreground/10 text-sidebar-foreground transition hover:bg-sidebar-foreground/20"
              >
                <Share2 className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              aria-label="Close"
              title="Close"
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-sidebar-foreground/10 text-sidebar-foreground transition hover:bg-sidebar-foreground/20"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Image area */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
          <TransformWrapper
            key={resetKey}
            initialScale={1}
            minScale={1}
            maxScale={6}
            doubleClick={{ mode: "toggle", step: 2 }}
            wheel={{ step: 0.2 }}
            pinch={{ step: 5 }}
            panning={{ velocityDisabled: true }}
          >
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                <TransformComponent
                  wrapperClass="!w-full !h-full"
                  contentClass="!w-full !h-full flex items-center justify-center"
                >
                  <img
                    src={photo.url}
                    alt={photo.caption ?? ""}
                    onLoad={() => setLoaded(true)}
                    draggable={false}
                    className={`max-h-full max-w-full select-none object-contain transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
                  />
                </TransformComponent>

                {!loaded && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sidebar-foreground/70">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                )}

                {/* Zoom controls - bigger, more visible */}
                <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-sidebar-border bg-sidebar/85 p-1.5 shadow-xl backdrop-blur">
                  <button
                    type="button"
                    aria-label="Zoom out"
                    onClick={() => zoomOut()}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-sidebar-foreground hover:bg-sidebar-foreground/15"
                  >
                    <ZoomOut className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Reset zoom"
                    onClick={() => resetTransform()}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-sidebar-foreground hover:bg-sidebar-foreground/15"
                  >
                    <RotateCcw className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Zoom in"
                    onClick={() => zoomIn()}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-sidebar-foreground hover:bg-sidebar-foreground/15"
                  >
                    <ZoomIn className="h-5 w-5" />
                  </button>
                </div>
              </>
            )}
          </TransformWrapper>

          {photos.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                onClick={() => go(-1)}
                className="absolute left-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-sidebar/70 text-sidebar-foreground transition hover:bg-sidebar sm:left-5"
              >
                <ChevronLeft className="h-7 w-7" />
              </button>
              <button
                type="button"
                aria-label="Next photo"
                onClick={() => go(1)}
                className="absolute right-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-sidebar/70 text-sidebar-foreground transition hover:bg-sidebar sm:right-5"
              >
                <ChevronRight className="h-7 w-7" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Side panel: rendered once so comments/tasks don't double-mount on desktop. */}
      {hasSidePanel && (
        <aside
          className={`absolute inset-x-0 bottom-0 z-[15] h-[65dvh] shrink-0 overflow-hidden rounded-t-2xl border-t border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.8)] md:static md:z-auto md:h-full md:w-[380px] md:rounded-none md:border-l md:border-t-0 md:shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.6)] lg:w-[420px] ${panelOpen ? "flex" : "hidden"}`}
        >
          {/* Mobile drag handle hint */}
          <div className="pointer-events-none absolute inset-x-0 top-1.5 flex justify-center md:hidden">
            <div className="h-1 w-10 rounded-full bg-sidebar-foreground/25" />
          </div>
          <div className="h-full min-h-0 w-full overflow-hidden">{sidePanel}</div>
        </aside>
      )}
    </div>,
    document.body,
  );
}
