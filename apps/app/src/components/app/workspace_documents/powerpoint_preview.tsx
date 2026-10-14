import { createInstance } from 'i18next';
import {
  type PowerPointViewerHandle,
  SlideCanvas,
  useViewerBuildingBlocks,
  type ViewerTheme,
  ViewerThemeProvider,
} from 'pptx-react-viewer';
import { keyToLabel, translationsEn } from 'pptx-react-viewer/i18n';
import { Component, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import {
  OfficePreviewError,
  OfficePreviewLoading,
} from '@/components/app/workspace_documents/office_preview_status';
import { PowerpointSlideSwitch } from '@/components/app/workspace_documents/powerpoint_slide_switch';

const viewer_tokens_that_follow_the_app_theme = [
  'background',
  'foreground',
  'card',
  'cardForeground',
  'popover',
  'primary',
  'primaryForeground',
  'secondary',
  'muted',
  'mutedForeground',
  'accent',
  'border',
  'input',
  'ring',
] as const;

const deck_theme: ViewerTheme = {
  colors: Object.fromEntries(
    viewer_tokens_that_follow_the_app_theme.map((token) => [
      token,
      `var(--${css_token_name(token)})`,
    ]),
  ),
};

function css_token_name(token: string) {
  return token.replace(/[A-Z]/g, (capital) => `-${capital.toLowerCase()}`);
}

const powerpoint_viewer_i18n = createInstance();
void powerpoint_viewer_i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  initAsync: false,
  resources: { en: { translation: translationsEn } },
  interpolation: { escapeValue: false },
  parseMissingKeyHandler: keyToLabel,
});

export type PowerpointPreviewProps = {
  bytes: ArrayBuffer;
  file_name: string;
};

/**
 * A presentation for reading: one slide at a time, with nothing around it but the control that
 * moves between slides. The library's full viewer chooses its ribbon and side panes from the
 * width of the window, not of the panel, so they do not fit a narrow panel.
 */
export function PowerpointPreview({ bytes, file_name }: PowerpointPreviewProps) {
  const content = useMemo(() => new Uint8Array(bytes), [bytes]);
  if (bytes.byteLength > 25 * 1024 * 1024) {
    return <OfficePreviewError message="This presentation exceeds the 25 MB preview limit." />;
  }
  return (
    <PowerpointErrorBoundary key={file_name}>
      <I18nextProvider i18n={powerpoint_viewer_i18n}>
        <PowerpointSlides content={content} file_name={file_name} />
      </I18nextProvider>
    </PowerpointErrorBoundary>
  );
}

function PowerpointSlides({ content, file_name }: { content: Uint8Array; file_name: string }) {
  const viewer = useRef<PowerPointViewerHandle>(null);
  const [slide_index, set_slide_index] = useState(0);
  const [slide_count, set_slide_count] = useState(0);
  const slides = useViewerBuildingBlocks({
    content,
    canEdit: false,
    fileName: file_name,
    autosaveEnabled: false,
    handle: viewer,
    onActiveSlideChange: set_slide_index,
    onSlideCountChange: set_slide_count,
  });
  if (slides.error) return <OfficePreviewError message={slides.error} />;
  if (slides.loading) return <OfficePreviewLoading label="Opening presentation..." />;
  return (
    <div className="flex h-full min-h-0 flex-col bg-sunken">
      <PowerpointShadowRoot>
        <ViewerThemeProvider theme={deck_theme}>
          <SlideCanvas {...slides.canvasProps} />
        </ViewerThemeProvider>
      </PowerpointShadowRoot>
      <PowerpointSlideSwitch
        slide_index={slide_index}
        slide_count={slide_count}
        onPrevious={() => viewer.current?.goPrev()}
        onNext={() => viewer.current?.goNext()}
      />
    </div>
  );
}

function PowerpointShadowRoot({ children }: { children: React.ReactNode }) {
  const [portal_root, set_portal_root] = useState<HTMLDivElement | null>(null);
  const set_host = (host: HTMLDivElement | null) => {
    if (!host || host.shadowRoot) return;
    const shadow = host.attachShadow({ mode: 'open' });
    const styles = document.createElement('link');
    styles.rel = 'stylesheet';
    styles.href = '/pptx-react-viewer.css';
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;height:100%';
    shadow.append(styles, root);
    set_portal_root(root);
  };
  return (
    <div className="min-h-0 flex-1 overflow-hidden p-3" ref={set_host}>
      {portal_root ? createPortal(children, portal_root) : null}
    </div>
  );
}

class PowerpointErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <OfficePreviewError message={this.state.error.message} />
    ) : (
      this.props.children
    );
  }
}
