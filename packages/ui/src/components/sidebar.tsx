'use client';

import { cn } from '@coworker/ui/lib/utils';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

const sidebar_collapsed_storage_key = 'sidebar:collapsed';
const sidebar_width_storage_key = 'sidebar:width';

const sidebar_default_width = 248;
const sidebar_min_width = 200;
const sidebar_max_width = 480;
const sidebar_rail_width = 56;
const sidebar_collapse_at_width = sidebar_min_width - 32;

type SidebarContextValue = {
  collapsed: boolean;
  ready: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
  width: number;
  setWidth: (value: number) => void;
  resetWidth: () => void;
};

function clamp_sidebar_width(value: number) {
  return Math.min(sidebar_max_width, Math.max(sidebar_min_width, value));
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider');
  return context;
}

function SidebarProvider({ className, children, style, ...props }: ComponentProps<'main'>) {
  const [collapsed, set_collapsed] = useState(false);
  const [width, set_width] = useState(sidebar_default_width);
  const [ready, set_ready] = useState(false);

  useEffect(() => {
    const saved_width = Number(window.localStorage.getItem(sidebar_width_storage_key));
    if (Number.isFinite(saved_width) && saved_width > 0) {
      set_width(clamp_sidebar_width(saved_width));
    }
    if (window.matchMedia('(max-width: 767px)').matches) {
      set_collapsed(true);
      return;
    }
    const saved = window.localStorage.getItem(sidebar_collapsed_storage_key);
    if (saved !== null) set_collapsed(saved === 'true');
  }, []);

  useEffect(() => {
    const mobile_query = window.matchMedia('(max-width: 767px)');
    const update_mobile_layout = (event: MediaQueryListEvent) => {
      set_collapsed(
        event.matches || window.localStorage.getItem(sidebar_collapsed_storage_key) === 'true',
      );
    };
    mobile_query.addEventListener('change', update_mobile_layout);
    return () => mobile_query.removeEventListener('change', update_mobile_layout);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => set_ready(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const setCollapsed = useCallback((value: boolean) => {
    set_collapsed(value);
    window.localStorage.setItem(sidebar_collapsed_storage_key, String(value));
  }, []);

  const toggle = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  const setWidth = useCallback(
    (value: number) => {
      if (value < sidebar_collapse_at_width) {
        setCollapsed(true);
        return;
      }
      const next = clamp_sidebar_width(value);
      set_width(next);
      set_collapsed(false);
      window.localStorage.setItem(sidebar_collapsed_storage_key, 'false');
      window.localStorage.setItem(sidebar_width_storage_key, String(next));
    },
    [setCollapsed],
  );

  const resetWidth = useCallback(() => {
    set_width(sidebar_default_width);
    window.localStorage.setItem(sidebar_width_storage_key, String(sidebar_default_width));
  }, []);

  return (
    <SidebarContext.Provider
      value={{ collapsed, ready, toggle, setCollapsed, width, setWidth, resetWidth }}
    >
      <main
        data-slot="sidebar-provider"
        data-collapsed={collapsed ? 'true' : 'false'}
        data-ready={ready ? 'true' : 'false'}
        style={
          {
            '--sidebar-width': `${collapsed ? sidebar_rail_width : width}px`,
            ...style,
          } as CSSProperties
        }
        className={cn(
          'group/sidebar grid min-h-screen grid-cols-[auto_minmax(0,1fr)] bg-background text-foreground max-md:h-dvh max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]',
          className,
        )}
        {...props}
      >
        {children}
      </main>
    </SidebarContext.Provider>
  );
}

function Sidebar({ className, onClickCapture, ...props }: ComponentProps<'aside'>) {
  const { collapsed, ready, setCollapsed } = useSidebar();

  return (
    <aside
      data-slot="sidebar"
      onClickCapture={(event) => {
        onClickCapture?.(event);
        if (
          !event.defaultPrevented &&
          window.matchMedia('(max-width: 767px)').matches &&
          event.target instanceof Element &&
          event.target.closest('a[href], [data-sidebar-close]')
        ) {
          setCollapsed(true);
        }
      }}
      className={cn(
        'flex flex-col border-r border-sidebar-border bg-sidebar text-sm text-sidebar-foreground duration-200 ease-in-out group-data-[ready=true]/sidebar:transition-[width] group-data-[resizing=true]/sidebar:transition-none md:sticky md:top-0 md:h-screen md:w-(--sidebar-width) max-md:min-h-0 max-md:w-full max-md:border-r-0 max-md:border-b',
        ready && !collapsed && 'max-md:h-dvh',
        'overflow-y-hidden md:overflow-x-visible',
        className,
      )}
      {...props}
    />
  );
}

function SidebarResizeHandle({ className, ...props }: ComponentProps<'div'>) {
  const { collapsed, setWidth, resetWidth, width } = useSidebar();
  const [is_dragging, set_is_dragging] = useState(false);

  useEffect(() => {
    const shell = document.querySelector('[data-slot="sidebar-provider"]');
    if (shell instanceof HTMLElement) shell.dataset.resizing = is_dragging ? 'true' : 'false';
  }, [is_dragging]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: the suggested <hr> is a decorative divider — it cannot take focus, hold aria-valuenow, or be dragged. A focusable separator carrying a value is the ARIA window-splitter pattern, which has no HTML element.
    <div
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemax={sidebar_max_width}
      aria-valuemin={sidebar_min_width}
      aria-valuenow={collapsed ? sidebar_rail_width : width}
      className={cn(
        'group/resize -right-1 absolute inset-y-0 z-20 hidden w-2 cursor-col-resize touch-none md:block',
        className,
      )}
      data-slot="sidebar-resize-handle"
      onDoubleClick={resetWidth}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') setWidth(width - 16);
        else if (event.key === 'ArrowRight') setWidth(width + 16);
        else return;
        event.preventDefault();
      }}
      onLostPointerCapture={() => set_is_dragging(false)}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        set_is_dragging(true);
      }}
      onPointerMove={(event) => {
        if (!is_dragging) return;
        setWidth(event.clientX);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        set_is_dragging(false);
      }}
      role="separator"
      tabIndex={0}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-sidebar-ring/70 opacity-0 transition-opacity',
          'group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100',
          is_dragging && 'opacity-100',
        )}
      />
    </div>
  );
}

function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('px-2.5 py-3', className)} {...props} />;
}

function SidebarContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-4 px-2.5 max-md:group-data-[collapsed=true]/sidebar:hidden max-md:group-data-[ready=false]/sidebar:hidden',
        className,
      )}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn(
        'mt-auto border-t border-sidebar-border px-2.5 py-2 max-md:group-data-[collapsed=true]/sidebar:hidden max-md:group-data-[ready=false]/sidebar:hidden',
        'max-md:min-h-0 max-md:overflow-y-auto',
        className,
      )}
      {...props}
    />
  );
}

function SidebarInset({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="sidebar-inset"
      className={cn('min-w-0 bg-background max-md:min-h-0 max-md:overflow-auto', className)}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="sidebar-group" className={cn('flex flex-col gap-1', className)} {...props} />
  );
}

function SidebarGroupLabel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        'px-2 text-xs font-medium text-muted-foreground md:group-data-[collapsed=true]/sidebar:hidden',
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul data-slot="sidebar-menu" className={cn('flex flex-col gap-0.5', className)} {...props} />
  );
}

function SidebarMenuItem({ className, ...props }: ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('list-none', className)} {...props} />;
}

function SidebarMenuButton({
  className,
  isActive,
  ...props
}: ComponentProps<'button'> & { isActive?: boolean }) {
  return (
    <button
      data-slot="sidebar-menu-button"
      data-active={isActive ? 'true' : undefined}
      className={cn(sidebar_menu_item_class_name, className)}
      type="button"
      {...props}
    />
  );
}

function SidebarMenuLink({
  className,
  isActive,
  ...props
}: ComponentProps<'a'> & { isActive?: boolean }) {
  return (
    <a
      data-slot="sidebar-menu-link"
      data-active={isActive ? 'true' : undefined}
      className={cn(sidebar_menu_item_class_name, className)}
      {...props}
    />
  );
}

const sidebar_menu_item_class_name =
  'row-interactive h-8 px-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 md:group-data-[collapsed=true]/sidebar:justify-center md:group-data-[collapsed=true]/sidebar:px-0 md:group-data-[collapsed=true]/sidebar:[&>span]:hidden [&_svg]:size-4 [&_svg]:shrink-0';

function SidebarTrigger({ className, ...props }: ComponentProps<'button'>) {
  const { collapsed, toggle } = useSidebar();
  return (
    <button
      type="button"
      data-slot="sidebar-trigger"
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      onClick={toggle}
      className={cn(
        'inline-grid size-7 shrink-0 place-items-center rounded-2xl text-muted-foreground transition-colors duration-150 ease-out-quart hover:bg-hover hover:text-foreground [&_svg]:size-4',
        className,
      )}
      {...props}
    >
      {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
    </button>
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuLink,
  SidebarProvider,
  SidebarResizeHandle,
  SidebarTrigger,
  sidebar_menu_item_class_name,
  useSidebar,
};
