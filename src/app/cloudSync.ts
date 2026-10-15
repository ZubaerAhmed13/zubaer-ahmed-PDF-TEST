/**
 * Optional, explicit Supabase preference sync.
 *
 * No PDF bytes, document text, filenames, form values or PDF passwords are
 * sent through this module. All existing PDF operations remain local/offline.
 * Auth tokens are scoped to the current tab via sessionStorage.
 */
const endpoint = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
const SESSION_KEY = 'docflow.cloud-session.v1';

export interface CloudToolState {
  favorite_tools: string[];
  recent_tools: string[];
}

interface CloudSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email?: string };
}

export interface CloudPanelOptions {
  allowedToolIds: ReadonlySet<string>;
  capture: () => CloudToolState;
  apply: (state: CloudToolState) => void;
}

export function sanitizeCloudTools(input: unknown, allowed: ReadonlySet<string>): CloudToolState {
  const object = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const clean = (field: string, max: number): string[] => {
    const value = object[field];
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const item of value) {
      if (typeof item === 'string' && allowed.has(item)) seen.add(item);
      if (seen.size >= max) break;
    }
    return [...seen];
  };
  return { favorite_tools: clean('favorite_tools', 30), recent_tools: clean('recent_tools', 6) };
}

function readSession(): CloudSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CloudSession>;
    if (
      typeof value.access_token !== 'string' ||
      typeof value.refresh_token !== 'string' ||
      typeof value.expires_at !== 'number' ||
      !value.user || typeof value.user.id !== 'string'
    ) return null;
    return value as CloudSession;
  } catch {
    return null;
  }
}

function saveSession(session: CloudSession | null): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage-blocked contexts may still use local PDF tools.
  }
}

function parseSession(response: Record<string, unknown>): CloudSession | null {
  const user = response.user as Record<string, unknown> | undefined;
  if (
    !user || typeof user.id !== 'string' ||
    typeof response.access_token !== 'string' ||
    typeof response.refresh_token !== 'string' ||
    typeof response.expires_in !== 'number'
  ) return null;
  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_at: Date.now() + response.expires_in * 1000,
    user: { id: user.id, ...(typeof user.email === 'string' ? { email: user.email } : {}) }
  };
}

async function api(path: string, method: string, payload?: unknown, accessToken?: string): Promise<unknown> {
  const response = await fetch(endpoint + path, {
    method,
    cache: 'no-store',
    headers: {
      apikey: publishableKey,
      ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
      ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });
  if (response.status === 204) return null;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const obj = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const message = typeof obj.msg === 'string' ? obj.msg
      : typeof obj.error_description === 'string' ? obj.error_description
      : typeof obj.message === 'string' ? obj.message
      : 'Cloud request failed (' + response.status + ').';
    throw new Error(message);
  }
  return data;
}

async function activeSession(): Promise<CloudSession> {
  const current = readSession();
  if (!current) throw new Error('Sign in before using cloud preferences.');
  if (current.expires_at > Date.now() + 30000) return current;
  const result = await api('/auth/v1/token?grant_type=refresh_token', 'POST', { refresh_token: current.refresh_token });
  const session = parseSession(result as Record<string, unknown>);
  if (!session) {
    saveSession(null);
    throw new Error('Your session expired. Sign in again.');
  }
  saveSession(session);
  return session;
}

export function mountCloudPanel(host: HTMLElement, options: CloudPanelOptions): void {
  host.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = 'Optional cloud preferences';
  host.append(heading);

  const introduction = document.createElement('p');
  introduction.textContent = 'Keep working locally without signing in. Cloud Sync stores only favorite and recent tool IDs in your separate DocFlow Supabase project, and only when you select Save.';
  host.append(introduction);

  if (!endpoint.startsWith('https://') || !publishableKey.startsWith('sb_publishable_')) {
    const notice = document.createElement('p');
    notice.textContent = 'Cloud Sync is not configured in this build. Your PDF tools still work offline.';
    host.append(notice);
    return;
  }

  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const identity = document.createElement('p');
  const credentials = document.createElement('form');
  credentials.className = 'docflow-cloud-form';
  const email = document.createElement('input');
  email.type = 'email';
  email.required = true;
  email.autocomplete = 'email';
  email.placeholder = 'Email address';
  email.setAttribute('aria-label', 'Cloud account email');
  const password = document.createElement('input');
  password.type = 'password';
  password.required = true;
  password.minLength = 8;
  password.autocomplete = 'current-password';
  password.placeholder = 'Password';
  password.setAttribute('aria-label', 'Cloud account password');

  const signIn = document.createElement('button');
  signIn.type = 'submit';
  signIn.className = 'primary';
  signIn.textContent = 'Sign in';
  const signUp = document.createElement('button');
  signUp.type = 'button';
  signUp.className = 'secondary';
  signUp.textContent = 'Create account';
  credentials.append(email, password, signIn, signUp);

  const actions = document.createElement('div');
  actions.className = 'docflow-cloud-actions';
  const upload = document.createElement('button');
  upload.type = 'button';
  upload.className = 'primary';
  upload.textContent = 'Save preferences to cloud';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'secondary';
  download.textContent = 'Restore cloud preferences';
  const signOut = document.createElement('button');
  signOut.type = 'button';
  signOut.className = 'secondary';
  signOut.textContent = 'Sign out';
  actions.append(upload, download, signOut);

  const caution = document.createElement('p');
  caution.className = 'help';
  caution.textContent = 'Manual sync only. Restoring replaces this device\'s favorites and recent tools. No PDF contents, filenames, saved recovery data or passwords are uploaded. Login session tokens are retained only for this browser tab.';
  host.append(identity, credentials, actions, caution, status);

  const updateUi = (): void => {
    const session = readSession();
    identity.textContent = session ? 'Signed in' + (session.user.email ? ' as ' + session.user.email : '') : 'Not signed in — local-only mode.';
    credentials.hidden = Boolean(session);
    actions.hidden = !session;
  };
  const setStatus = (message: string): void => { status.textContent = message; };
  const working = async (label: string, work: () => Promise<string>): Promise<void> => {
    signIn.disabled = signUp.disabled = upload.disabled = download.disabled = signOut.disabled = true;
    setStatus(label);
    try {
      setStatus(await work());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not connect to the cloud. Local PDF tools are unaffected.');
    } finally {
      signIn.disabled = signUp.disabled = upload.disabled = download.disabled = signOut.disabled = false;
      password.value = '';
      updateUi();
    }
  };

  credentials.addEventListener('submit', (event) => {
    event.preventDefault();
    void working('Signing in…', async () => {
      const data = await api('/auth/v1/token?grant_type=password', 'POST', { email: email.value.trim(), password: password.value });
      const session = parseSession(data as Record<string, unknown>);
      if (!session) throw new Error('Sign-in response did not contain an active session.');
      saveSession(session);
      return 'Signed in. Choose Save or Restore to synchronize preferences.';
    });
  });

  signUp.addEventListener('click', () => {
    if (!credentials.reportValidity()) return;
    void working('Creating account…', async () => {
      const redirect = encodeURIComponent(location.origin + location.pathname);
      const data = await api('/auth/v1/signup?redirect_to=' + redirect, 'POST', { email: email.value.trim(), password: password.value });
      const session = parseSession(data as Record<string, unknown>);
      if (session) saveSession(session);
      return session ? 'Account created. You can now save preferences.' : 'Check your email for an account confirmation, then sign in here.';
    });
  });

  upload.addEventListener('click', () => {
    void working('Saving preferences…', async () => {
      const session = await activeSession();
      const state = sanitizeCloudTools(options.capture(), options.allowedToolIds);
      await api('/rest/v1/docflow_preferences?on_conflict=user_id', 'POST', {
        user_id: session.user.id,
        favorite_tools: state.favorite_tools,
        recent_tools: state.recent_tools,
        updated_at: new Date().toISOString()
      }, session.access_token);
      return 'Preferences saved to your private DocFlow project.';
    });
  });

  download.addEventListener('click', () => {
    void working('Loading cloud preferences…', async () => {
      const session = await activeSession();
      const data = await api('/rest/v1/docflow_preferences?select=favorite_tools,recent_tools&user_id=eq.' + encodeURIComponent(session.user.id), 'GET', undefined, session.access_token);
      if (!Array.isArray(data) || !data.length) return 'No saved cloud preferences yet. Select Save on your first device.';
      options.apply(sanitizeCloudTools(data[0], options.allowedToolIds));
      return 'Cloud favorites and recent tools restored on this device.';
    });
  });

  signOut.addEventListener('click', () => {
    void working('Signing out…', async () => {
      const session = readSession();
      saveSession(null);
      if (session) {
        try { await api('/auth/v1/logout', 'POST', undefined, session.access_token); }
        catch { /* Local sign-out still succeeds if offline. */ }
      }
      return 'Signed out of cloud preferences. Local tools remain available.';
    });
  });

  updateUi();
}
