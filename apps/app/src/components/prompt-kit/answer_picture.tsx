import { ImageOff } from 'lucide-react';
import { createContext, type ReactNode, useContext, useState } from 'react';
import {
  read_picture_source,
  workspace_picture_paths,
} from '@/components/prompt-kit/picture_source';
import { workspace_file_download_url } from '@/lib/api';

const no_folders: readonly string[] = [];
const folders_in_the_text_context = createContext(no_folders);

/** Tells the pictures of one text which workspace folders that text names. */
export const FoldersInTheTextProvider = folders_in_the_text_context.Provider;

const quiet_text_class_name = 'text-[13px] text-muted-foreground';

/**
 * A picture in text the model wrote. The browser loads it by itself only when it is a file of
 * the workspace or is held in the text. A picture of another site shows the name of the site
 * and loads after the person asks for it, once, for this picture only.
 */
export function AnswerPicture({ src, alt }: { src?: unknown; alt?: string | undefined }) {
  const source = read_picture_source(typeof src === 'string' ? src : undefined);
  const name = alt?.trim() || 'Picture';
  if (source.kind === 'workspace_file') {
    return <WorkspacePicture file_path={source.file_path} name={alt?.trim() ?? ''} />;
  }
  if (source.kind === 'held_in_the_text') {
    return <img alt={name} className="max-w-full rounded-2xl" src={source.address} />;
  }
  if (source.kind === 'other_site') {
    return <PictureOfAnotherSite address={source.address} host={source.host} name={name} />;
  }
  return <span className={quiet_text_class_name}>{name}</span>;
}

function WorkspacePicture({ file_path, name }: { file_path: string; name: string }) {
  const paths = workspace_picture_paths(file_path, useContext(folders_in_the_text_context));
  const [tried, set_tried] = useState({ file_path, missing_count: 0 });
  const [loaded_path, set_loaded_path] = useState<string | null>(null);
  const missing_count = tried.file_path === file_path ? tried.missing_count : 0;
  const path = paths[missing_count];
  const file_name = file_path.slice(file_path.lastIndexOf('/') + 1);
  if (!path) return <span className={quiet_text_class_name}>{name || file_name}</span>;
  return (
    <img
      alt={name || file_name}
      className="max-w-full rounded-2xl"
      hidden={loaded_path !== path}
      key={path}
      src={workspace_file_download_url(path)}
      onError={() => set_tried({ file_path, missing_count: missing_count + 1 })}
      onLoad={() => set_loaded_path(path)}
    />
  );
}

function PictureOfAnotherSite(props: { address: string; host: string; name: string }) {
  const [shown_address, set_shown_address] = useState<string | null>(null);
  if (shown_address === props.address) {
    return (
      <img
        alt={props.name}
        className="max-w-full rounded-2xl"
        referrerPolicy="no-referrer"
        src={props.address}
      />
    );
  }
  return (
    <button
      className="inline-flex max-w-full items-center gap-2 rounded-2xl border border-border px-2.5 py-1.5 text-left text-[13px] text-muted-foreground hover:text-foreground"
      title={props.address}
      type="button"
      onClick={() => set_shown_address(props.address)}
    >
      <ImageOff aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 truncate">Show picture from {props.host}</span>
    </button>
  );
}

function OnlyTheChildren({ children }: { children?: ReactNode }) {
  return children;
}

function Nothing() {
  return null;
}

/**
 * The components that draw every picture of model-written text. A `picture` tag keeps only its
 * image, and a `source` tag is dropped: its address list would load in place of the image the
 * person chose to show.
 */
export const picture_components = { img: AnswerPicture, picture: OnlyTheChildren, source: Nothing };
