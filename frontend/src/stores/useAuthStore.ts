import { create } from 'zustand';

/**
 * Decode the `role` claim from a JWT access token without external deps.
 *
 * The token shape is `header.payload.signature`, all base64url-encoded JSON.
 * We only need the `role` claim — everything else is verified server-side.
 * Returns the role string, or `null` for any decoding error / missing claim.
 */
function decodeRoleFromToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url → base64
    const payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as { role?: string };
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

interface AuthState {
  accessToken: string | null;
  isAuthenticated: boolean;
  userEmail: string | null;
  userRole: string | null;
  setTokens: (access: string, refresh: string, remember?: boolean, email?: string) => void;
  logout: () => void;
  loadFromStorage: () => void;
}

const KEY_ACCESS = 'oe_access_token';
const KEY_REFRESH = 'oe_refresh_token';
const KEY_REMEMBER = 'oe_remember';
const KEY_EMAIL = 'oe_user_email';

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  isAuthenticated: false,
  userEmail: null,
  userRole: null,

  setTokens: (access, refresh, remember = false, email) => {
    if (remember) {
      localStorage.setItem(KEY_REMEMBER, '1');
      localStorage.setItem(KEY_ACCESS, access);
      localStorage.setItem(KEY_REFRESH, refresh);
      sessionStorage.removeItem(KEY_ACCESS);
      sessionStorage.removeItem(KEY_REFRESH);
    } else {
      localStorage.removeItem(KEY_REMEMBER);
      localStorage.removeItem(KEY_ACCESS);
      localStorage.removeItem(KEY_REFRESH);
      sessionStorage.setItem(KEY_ACCESS, access);
      sessionStorage.setItem(KEY_REFRESH, refresh);
    }
    if (email) localStorage.setItem(KEY_EMAIL, email);
    set({
      accessToken: access,
      isAuthenticated: true,
      userEmail: email ?? null,
      userRole: decodeRoleFromToken(access),
    });
  },

  logout: () => {
    localStorage.removeItem(KEY_ACCESS);
    localStorage.removeItem(KEY_REFRESH);
    localStorage.removeItem(KEY_REMEMBER);
    localStorage.removeItem(KEY_EMAIL);
    sessionStorage.removeItem(KEY_ACCESS);
    sessionStorage.removeItem(KEY_REFRESH);
    set({ accessToken: null, isAuthenticated: false, userEmail: null, userRole: null });
  },

  loadFromStorage: () => {
    const token =
      localStorage.getItem(KEY_ACCESS) || sessionStorage.getItem(KEY_ACCESS);
    const email = localStorage.getItem(KEY_EMAIL);
    set({
      accessToken: token,
      isAuthenticated: Boolean(token),
      userEmail: email,
      userRole: decodeRoleFromToken(token),
    });
  },
}));
