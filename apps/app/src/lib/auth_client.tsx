import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type SessionUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
};

type SessionImpersonator = {
  email: string;
  reason: string | null;
};

type AuthState = {
  user: SessionUser | null;
  organization_id: string | null;
  impersonator: SessionImpersonator | null;
  loading: boolean;
};

type AuthContextValue = AuthState & {
  signOut: (options?: { returnTo?: string }) => void;
  refreshAuth: () => Promise<void>;
};

const signed_out_state: AuthState = {
  user: null,
  organization_id: null,
  impersonator: null,
  loading: true,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AppAuthProvider({ children }: { children: ReactNode }) {
  const [state, set_state] = useState<AuthState>(signed_out_state);

  useEffect(() => {
    let cancelled = false;
    void fetch_session().then((session) => {
      if (!cancelled) set_state(session);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh_auth = useCallback(async () => set_state(await fetch_session()), []);
  const value: AuthContextValue = useMemo(
    () => ({ ...state, signOut: sign_out, refreshAuth: refresh_auth }),
    [state, refresh_auth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AppAuthProvider');
  return value;
}

async function fetch_session(): Promise<AuthState> {
  try {
    const response = await fetch('/auth/session', { headers: { accept: 'application/json' } });
    if (!response.ok) return { ...signed_out_state, loading: false };
    const body = (await response.json()) as {
      user: SessionUser | null;
      organizationId: string | null;
      impersonator: SessionImpersonator | null;
    };
    return {
      user: body.user,
      organization_id: body.organizationId,
      impersonator: body.impersonator,
      loading: false,
    };
  } catch {
    return { ...signed_out_state, loading: false };
  }
}

// Ends the session on the server (WorkOS logout revokes it) and follows its redirect back.
//
// A submitted form, not fetch(): the route answers 303, so the browser GETs the WorkOS logout URL
// (it 404s on a repeated POST), and only a document navigation follows a cross-origin redirect.
// A form POST also carries the Sec-Fetch-Site header the route checks; no cross-site page can.
function sign_out(options?: { returnTo?: string }): void {
  const return_to = options?.returnTo ?? '/';
  const form = document.createElement('form');
  form.method = 'post';
  form.action = `/auth/sign-out?returnTo=${encodeURIComponent(return_to)}`;
  form.hidden = true;
  document.body.append(form);
  form.submit();
}
