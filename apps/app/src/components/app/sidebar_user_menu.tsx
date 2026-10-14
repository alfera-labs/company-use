import { format_person_name } from '@coworker/shared';
import { Avatar, AvatarFallback, AvatarImage } from '@coworker/ui/components/avatar';
import { Button } from '@coworker/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { ChevronsUpDown, LogOut, Moon, Sun, User } from 'lucide-react';
import { useTheme } from 'next-themes';
import { user_initials } from '@/components/app/user_initials';
import { useAuth } from '@/lib/auth_client';
import { is_local_user } from '@/lib/local_identity';

export function SidebarUserMenu() {
  const { user, loading } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();

  if (loading) {
    return (
      <div className="flex h-12 items-center gap-2.5 px-1.5 md:group-data-[collapsed=true]/sidebar:justify-center">
        <Avatar className="size-8 animate-pulse">
          <AvatarFallback>
            <User className="size-4" />
          </AvatarFallback>
        </Avatar>
        <div className="h-3 w-24 animate-pulse rounded bg-muted md:group-data-[collapsed=true]/sidebar:hidden" />
      </div>
    );
  }

  if (!user) {
    return (
      <Button
        className="w-full md:group-data-[collapsed=true]/sidebar:px-0"
        variant="outline"
        onClick={() => redirect_to_sign_in()}
      >
        <User className="size-4" />
        <span className="md:group-data-[collapsed=true]/sidebar:hidden">Sign in</span>
      </Button>
    );
  }

  const display_name = format_person_name(user.firstName, user.lastName, user.email || 'Account');
  const is_dark = resolvedTheme === 'dark';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarAccountTrigger
            display_name={display_name}
            email={user.email}
            image_url={user.profilePictureUrl}
            initials={user_initials(user.firstName, user.lastName, user.email)}
          />
        }
      />
      <DropdownMenuContent side="top" align="end" sideOffset={8} className="min-w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{display_name}</span>
          {user.email ? <span className="truncate">{user.email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setTheme(is_dark ? 'light' : 'dark')}>
          {is_dark ? <Sun /> : <Moon />}
          {is_dark ? 'Light mode' : 'Dark mode'}
        </DropdownMenuItem>
        {is_local_user(user) ? null : <SignOutMenuItem />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function redirect_to_sign_in() {
  const return_to = `${window.location.pathname}${window.location.search}`;
  window.location.href = `/auth/sign-in?returnTo=${encodeURIComponent(return_to)}`;
}

export function SidebarAccountTrigger({
  display_name,
  email,
  image_url,
  initials,
  ...props
}: React.ComponentProps<'button'> & {
  display_name: string;
  email?: string | null;
  image_url?: string | null;
  initials: string;
}) {
  return (
    <button
      {...props}
      type="button"
      aria-label="Account menu"
      className="flex w-full items-center gap-2.5 rounded-2xl p-1.5 text-left transition-colors hover:bg-sidebar-accent md:group-data-[collapsed=true]/sidebar:justify-center md:group-data-[collapsed=true]/sidebar:p-1"
    >
      <Avatar className="size-8">
        {image_url ? <AvatarImage src={image_url} alt={display_name} /> : null}
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 md:group-data-[collapsed=true]/sidebar:hidden">
        <span className="block truncate text-sm font-medium text-foreground">{display_name}</span>
        {email ? (
          <span className="block truncate text-xs text-muted-foreground">{email}</span>
        ) : null}
      </span>
      <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground md:group-data-[collapsed=true]/sidebar:hidden" />
    </button>
  );
}

function SignOutMenuItem() {
  const { signOut } = useAuth();
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onClick={() => void signOut({ returnTo: window.location.origin })}
      >
        <LogOut />
        Sign out
      </DropdownMenuItem>
    </>
  );
}
