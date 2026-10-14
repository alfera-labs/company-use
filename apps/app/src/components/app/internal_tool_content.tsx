import { ExternalLink, FileText } from 'lucide-react';
import { useState } from 'react';
import type { InternalToolView } from '@/components/app/internal_tool_view';
import { safe_http_url, safe_image_url, safe_tool_url } from '@/components/app/internal_tool_view';

export function InternalToolContent({
  onArtifactOpen,
  view,
}: {
  onArtifactOpen?: (file_id: string) => void;
  view: InternalToolView;
}) {
  return (
    <div className="space-y-3">
      {view.summary ? <p className="text-[13px] text-foreground">{view.summary}</p> : null}
      {view.notice ? <p className="text-[12px] text-foreground">{view.notice}</p> : null}
      {view.calculation ? <CalculationContent calculation={view.calculation} /> : null}
      {view.fields?.length ? <FieldContent fields={view.fields} /> : null}
      {view.text ? (
        <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground">
          {view.text}
        </p>
      ) : null}
      {view.images?.length ? <ImageContent images={view.images} /> : null}
      {view.items?.length ? (
        <ItemContent items={view.items} {...(onArtifactOpen ? { onArtifactOpen } : {})} />
      ) : null}
      {view.empty_message && !view_has_content(view) ? (
        <p className="text-[13px] text-muted-foreground">{view.empty_message}</p>
      ) : null}
    </div>
  );
}

function CalculationContent({
  calculation,
}: {
  calculation: NonNullable<InternalToolView['calculation']>;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 font-mono text-[13px]">
      <span className="break-words text-muted-foreground">{calculation.expression}</span>
      <span className="break-words font-medium text-foreground">
        {calculation.exact === false ? '≈ ' : ''}
        {calculation.result}
      </span>
      {calculation.fraction ? (
        <span className="text-[12px] text-muted-foreground">{calculation.fraction}</span>
      ) : null}
    </div>
  );
}

function FieldContent({ fields }: { fields: NonNullable<InternalToolView['fields']> }) {
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-[max-content_1fr]">
      {fields.map((field) => (
        <div className="contents" key={`${field.label}:${field.value}`}>
          <dt className="text-muted-foreground">{field.label}</dt>
          <dd className="min-w-0 break-words text-foreground">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ImageContent({ images }: { images: NonNullable<InternalToolView['images']> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {images.map((image) => {
        const image_url = safe_image_url(image.image_url);
        if (!image_url) return null;
        const source_url = safe_http_url(image.source_url);
        const image_key = `${image_url}:${source_url ?? ''}:${image.title}`;
        const picture = <ToolImage alt={image.title} key={image_key} src={image_url} />;
        return source_url ? (
          <a
            className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={source_url}
            key={image_key}
            rel="noreferrer"
            target="_blank"
          >
            {picture}
          </a>
        ) : (
          <div key={image_key}>{picture}</div>
        );
      })}
    </div>
  );
}

function ItemContent({
  items,
  onArtifactOpen,
}: {
  items: NonNullable<InternalToolView['items']>;
  onArtifactOpen?: (file_id: string) => void;
}) {
  return (
    <div className="space-y-1">
      {items.map((item) => {
        const url = safe_tool_url(item.url);
        const item_key = `${item.file_id ?? ''}:${url ?? ''}:${item.title}:${item.detail ?? ''}`;
        const content = (
          <>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-[13px] font-medium text-foreground">
                {item.title}
              </span>
              {item.detail ? (
                <span className="mt-0.5 block break-words text-[12px] text-muted-foreground">
                  {item.detail}
                </span>
              ) : null}
            </span>
            {url ? <ExternalLink aria-hidden className="size-3.5 shrink-0" /> : null}
            {item.file_id && onArtifactOpen ? (
              <FileText aria-hidden className="size-3.5 shrink-0" />
            ) : null}
          </>
        );
        const class_name =
          'flex w-full items-start gap-2 py-1 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';
        if (url) {
          return (
            <a className={class_name} href={url} key={item_key} rel="noreferrer" target="_blank">
              {content}
            </a>
          );
        }
        if (item.file_id && onArtifactOpen) {
          return (
            <button
              className={class_name}
              key={item_key}
              type="button"
              onClick={() => onArtifactOpen(item.file_id as string)}
            >
              {content}
            </button>
          );
        }
        return (
          <div className="flex w-full items-start gap-2 py-1 text-left" key={item_key}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

function ToolImage({ alt, src }: { alt: string; src: string }) {
  const [failed, set_failed] = useState(false);
  if (failed) {
    return (
      <span className="grid aspect-video place-items-center rounded-xl bg-muted px-2 text-center text-[11px] text-muted-foreground">
        Image unavailable
      </span>
    );
  }
  return (
    <img
      alt={alt}
      className="aspect-video w-full rounded-xl object-cover"
      src={src}
      onError={() => set_failed(true)}
    />
  );
}

function view_has_content(view: InternalToolView) {
  return Boolean(
    view.summary ||
      view.notice ||
      view.text ||
      view.calculation ||
      view.fields?.length ||
      view.images?.length ||
      view.items?.length,
  );
}
