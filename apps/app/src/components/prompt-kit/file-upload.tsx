import {
  Children,
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

type FileUploadContextValue = {
  disabled?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  multiple?: boolean;
};

const FileUploadContext = createContext<FileUploadContextValue | null>(null);

function FileUpload({
  accept,
  children,
  disabled = false,
  multiple = true,
  onFilesAdded,
}: {
  accept?: string;
  children: React.ReactNode;
  disabled?: boolean;
  multiple?: boolean;
  onFilesAdded: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const add_selected_files = useCallback(
    (files: FileList) => onFilesAdded(Array.from(files).slice(0, multiple ? undefined : 1)),
    [multiple, onFilesAdded],
  );

  const context_value = useMemo(() => ({ disabled, inputRef, multiple }), [disabled, multiple]);

  return (
    <FileUploadContext.Provider value={context_value}>
      <input
        accept={accept}
        className="hidden"
        disabled={disabled}
        multiple={multiple}
        ref={inputRef}
        type="file"
        onChange={(event) => {
          if (event.currentTarget.files?.length) add_selected_files(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      {children}
    </FileUploadContext.Provider>
  );
}

function FileUploadTrigger({ children }: { children: React.ReactElement }) {
  const context = useContext(FileUploadContext);
  const child = Children.only(children) as React.ReactElement<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  >;

  return cloneElement(child, {
    disabled: context?.disabled || child.props.disabled,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      context?.inputRef.current?.click();
      child.props.onClick?.(event);
    },
  });
}

function useFileDrop(onFilesAdded: (files: File[]) => void) {
  const [isDragging, setIsDragging] = useState(false);
  return {
    isDragging,
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(true);
    },
    onDragLeave: () => setIsDragging(false),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      onFilesAdded(Array.from(event.dataTransfer.files ?? []));
    },
  };
}

export { FileUpload, FileUploadTrigger, useFileDrop };
