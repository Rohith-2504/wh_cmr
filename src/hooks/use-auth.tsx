"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { PostgrestError, User } from "@supabase/supabase-js";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import {
  isMissingColumnError,
  isMissingSchemaResourceError,
  normalizeProfileRow,
  PROFILE_SELECT_LEGACY,
  PROFILE_SELECT_WITH_ACCOUNT,
} from "@/lib/auth/profile-load";
import {
  canEditSettings as canEditSettingsFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  type AccountRole,
} from "@/lib/auth/roles";

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  /**
   * Opted-in beta feature keys for this account. No current feature
   * reads this — Flows was the last user and went to soft-GA in PR
   * #134 — but the column survives for future beta gates.
   */
  beta_features: string[];
  account_id: string | null;
  account_role: AccountRole | null;
}

interface AccountSummary {
  id: string;
  name: string;
  /** Default deal currency (ISO-4217). NOT NULL DEFAULT 'USD' in the
   *  DB (migration 021); narrowed to DEFAULT_CURRENCY when absent. */
  default_currency: string;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  accountId: string | null;
  accountRole: AccountRole | null;
  account: AccountSummary | null;
  /** True when profiles.account_id is absent (pre migration 017). */
  legacyAccountSharing: boolean;
  defaultCurrency: string;
  isOwner: boolean;
  isAdmin: boolean;
  isAgent: boolean;
  isViewer: boolean;
  canManageMembers: boolean;
  canEditSettings: boolean;
  canSendMessages: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isMeaningfulPostgrestError(
  error: PostgrestError | null | undefined,
): error is PostgrestError {
  return !!error && !!(error.message || error.code);
}

function logSupabaseError(context: string, error: unknown): void {
  if (error && typeof error === "object") {
    const pg = error as PostgrestError;
    if (isMissingSchemaResourceError(pg)) {
      console.warn(context, {
        message: pg.message,
        details: pg.details,
        hint: pg.hint,
        code: pg.code,
      });
      return;
    }
    if (pg.message || pg.code) {
      console.error(context, {
        message: pg.message,
        details: pg.details,
        hint: pg.hint,
        code: pg.code,
      });
      return;
    }
  }
  console.error(context, error);
}

/**
 * AuthProvider — wrap this around the dashboard layout.
 * Makes ONE getUser() call for the whole tree instead of one per
 * component, avoiding internal lock contention in the Supabase client.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [legacyAccountSharing, setLegacyAccountSharing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const supabase = createClient();
    setProfileLoading(true);
    try {
      let { data, error } = await supabase
        .from("profiles")
        .select(PROFILE_SELECT_WITH_ACCOUNT)
        .eq("user_id", userId)
        .maybeSingle();

      let legacy = false;
      if (error && isMissingColumnError(error)) {
        console.warn(
          "[AuthProvider] fetchProfile: extended profile columns missing, falling back to legacy select",
        );
        ({ data, error } = await supabase
          .from("profiles")
          .select(PROFILE_SELECT_LEGACY)
          .eq("user_id", userId)
          .maybeSingle());
        legacy = true;
      }

      if (isMeaningfulPostgrestError(error)) {
        logSupabaseError("[AuthProvider] fetchProfile error:", error);
        setProfile(null);
        setAccount(null);
        setLegacyAccountSharing(false);
        return;
      }

      if (!data) {
        console.warn(
          "[AuthProvider] fetchProfile: authenticated user has no profile row yet",
          userId,
        );
        setProfile(null);
        setAccount(null);
        setLegacyAccountSharing(false);
        return;
      }

      setLegacyAccountSharing(legacy);
      const row = normalizeProfileRow(data, { userId, legacy });

      let accountRow: AccountSummary | null = null;
      if (row.account_id && !legacy) {
        const { data: accountData, error: accountErr } = await supabase
          .from("accounts")
          .select("id, name, default_currency")
          .eq("id", row.account_id)
          .maybeSingle();
        if (isMeaningfulPostgrestError(accountErr)) {
          logSupabaseError("[AuthProvider] fetchAccount error:", accountErr);
        } else if (accountData) {
          accountRow = {
            id: accountData.id,
            name: accountData.name,
            default_currency: accountData.default_currency ?? DEFAULT_CURRENCY,
          };
        }
      }

      if (!accountRow && row.account_id) {
        accountRow = {
          id: row.account_id,
          name: row.full_name?.trim() || "My account",
          default_currency: DEFAULT_CURRENCY,
        };
      }

      setProfile({
        id: row.id,
        full_name: row.full_name,
        email: row.email,
        avatar_url: row.avatar_url,
        role: row.role,
        beta_features: row.beta_features,
        account_id: row.account_id,
        account_role: row.account_role,
      });
      setAccount(accountRow);
    } catch (err) {
      console.error("[AuthProvider] fetchProfile threw:", err);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    const safetyTimer = setTimeout(() => {
      if (mounted) {
        console.warn("[AuthProvider] getUser() timed out after 3s");
        setLoading(false);
        setProfileLoading(false);
      }
    }, 3000);

    const init = async () => {
      try {
        const {
          data: { user: currentUser },
          error,
        } = await supabase.auth.getUser();

        if (error) logSupabaseError("[AuthProvider] getUser error:", error);
        if (!mounted) return;

        setUser(currentUser);

        if (currentUser) {
          fetchProfile(currentUser.id);
        } else {
          setProfileLoading(false);
        }
      } catch (err) {
        console.error("[AuthProvider] init threw:", err);
      } finally {
        if (mounted) setLoading(false);
        clearTimeout(safetyTimer);
      }
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const currentUser = session?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        fetchProfile(currentUser.id);
      } else {
        setProfile(null);
        setAccount(null);
        setLegacyAccountSharing(false);
        setProfileLoading(false);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setAccount(null);
    setLegacyAccountSharing(false);
    window.location.href = "/login";
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return;
    await fetchProfile(user.id);
  }, [user?.id, fetchProfile]);

  const derived = useMemo(() => {
    const role = profile?.account_role ?? null;
    return {
      accountRole: role,
      accountId: profile?.account_id ?? null,
      isOwner: role === "owner",
      isAdmin: role === "admin",
      isAgent: role === "agent",
      isViewer: role === "viewer",
      canManageMembers: role ? canManageMembersFor(role) : false,
      canEditSettings: role ? canEditSettingsFor(role) : false,
      canSendMessages: role ? canSendMessagesFor(role) : false,
    };
  }, [profile?.account_role, profile?.account_id]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        profileLoading,
        signOut,
        refreshProfile,
        account,
        legacyAccountSharing,
        defaultCurrency: account?.default_currency ?? DEFAULT_CURRENCY,
        ...derived,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      signOut: async () => {
        window.location.href = "/login";
      },
      refreshProfile: async () => {},
      account: null,
      legacyAccountSharing: false,
      defaultCurrency: DEFAULT_CURRENCY,
      accountId: null,
      accountRole: null,
      isOwner: false,
      isAdmin: false,
      isAgent: false,
      isViewer: false,
      canManageMembers: false,
      canEditSettings: false,
      canSendMessages: false,
    };
  }
  return ctx;
}
