import { Textarea } from '@coworker/ui/components/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@coworker/ui/components/tooltip';
import { cn } from '@coworker/ui/lib/utils';
import { createContext, useContext, useEffect, useRef } from 'react';

type PromptInputContextValue = {
  value: string;
  setValue: (value: string) => void;
  maxHeight: number | string;
  onSubmit: (() => void) | undefined;
  disabled?: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
};

const PromptInputContext = createContext<PromptInputContextValue | null>(null);

function usePromptInput() {
  const context = useContext(PromptInputContext);
  if (!context) throw new Error('usePromptInput must be used within PromptInput');
  return context;
}

function PromptInput({
  children,
  className,
  disabled = false,
  maxHeight = 240,
  onSubmit,
  onValueChange,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  maxHeight?: number | string;
  onSubmit?: () => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <PromptInputContext.Provider
      value={{ disabled, maxHeight, onSubmit, setValue: onValueChange, textareaRef, value }}
    >
      <fieldset
        className={cn(
          'm-0 min-w-0 cursor-text rounded-[28px] bg-floating p-1.5 shadow-float ring-1 ring-border',
          className,
        )}
        onMouseDown={(event) => {
          if (is_form_control(event.target)) return;
          textareaRef.current?.focus();
        }}
      >
        {children}
      </fieldset>
    </PromptInputContext.Provider>
  );
}

function PromptInputTextarea({
  className,
  onKeyDown,
  ...props
}: React.ComponentProps<typeof Textarea>) {
  const { disabled, maxHeight, onSubmit, setValue, textareaRef, value } = usePromptInput();
  useAutosizeTextarea(className);
  useFocusWhenUsableAgain(textareaRef, disabled);

  return (
    <Textarea
      ref={textareaRef}
      autoFocus
      className={cn(
        'max-h-(--prompt-input-max-height) min-h-11 w-full resize-none border-none bg-transparent text-foreground shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
        'overflow-y-auto disabled:cursor-text disabled:opacity-100',
        className,
      )}
      disabled={disabled}
      rows={1}
      style={{ '--prompt-input-max-height': height_value(maxHeight) } as React.CSSProperties}
      value={value}
      onChange={(event) => setValue(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          onSubmit?.();
        }
        onKeyDown?.(event);
      }}
      {...props}
    />
  );
}

function PromptInputActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-2', className)} {...props} />;
}

function PromptInputAction({
  children,
  tooltip,
}: {
  children: React.ReactElement;
  tooltip: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={children}
        onClick={(event) => {
          event.stopPropagation();
        }}
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function useFocusWhenUsableAgain(
  textarea_ref: React.RefObject<HTMLTextAreaElement | null>,
  disabled: boolean | undefined,
) {
  const was_disabled_ref = useRef(disabled);
  useEffect(() => {
    if (was_disabled_ref.current && !disabled) textarea_ref.current?.focus();
    was_disabled_ref.current = disabled;
  }, [disabled, textarea_ref]);
}

function useAutosizeTextarea(size_class_name: string | undefined) {
  const { textareaRef, value } = usePromptInput();

  // biome-ignore lint/correctness/useExhaustiveDependencies: the text and the size classes change the height
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [textareaRef, value, size_class_name]);
}

function is_form_control(value: EventTarget) {
  return value instanceof HTMLElement && Boolean(value.closest('button,a,input,textarea,select'));
}

function height_value(value: number | string) {
  return typeof value === 'number' ? `${value}px` : value;
}

export { PromptInput, PromptInputAction, PromptInputActions, PromptInputTextarea };
