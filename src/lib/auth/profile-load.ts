import type { PostgrestError } from "@supabase/supabase-js";

import { isAccountRole, type AccountRole } from "./roles";

/** Postgres undefined_column — emitted when a SELECT references a column
 *  the DB hasn't been migrated to yet (e.g. profiles.account_id pre-017). */
export function isMissingColumnError(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  return (
    typeof error.message === "string" &&
    error.message.includes("does not exist")
  );
}

/** PostgREST schema-cache miss — table/RPC not migrated yet (e.g. accounts
 *  pre-017, touch_presence pre-018). Non-fatal for legacy single-user mode. */
export function isMissingSchemaResourceError(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "PGRST202") return true;
  const message = error.message ?? "";
  return (
    message.includes("Could not find the table") ||
    message.includes("Could not find the function")
  );
}

/**
 * Map legacy `profiles.role` TEXT (pre account-sharing migration) onto the
 * modern AccountRole union. Sole-tenant installs had no teammates, so the
 * signed-in user is treated as owner unless their legacy role is admin.
 */
export function mapLegacyProfileRole(
  role: string | null | undefined,
): AccountRole {
  const normalized = (role ?? "").trim().toLowerCase();
  if (normalized === "admin") return "admin";
  return "owner";
}

export const PROFILE_SELECT_WITH_ACCOUNT =
  "id, full_name, email, avatar_url, role, beta_features, account_id, account_role";

export const PROFILE_SELECT_LEGACY =
  "id, full_name, email, avatar_url, role, beta_features";

export interface LoadedProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  beta_features: string[];
  account_id: string | null;
  account_role: AccountRole | null;
}

/** Normalize a profile row from either the modern or legacy SELECT shape. */
export function normalizeProfileRow(
  row: {
    id: string;
    full_name: string | null;
    email: string;
    avatar_url: string | null;
    role: string | null;
    beta_features?: string[] | null;
    account_id?: string | null;
    account_role?: string | null;
  },
  opts: { userId: string; legacy: boolean },
): LoadedProfileRow {
  const accountRole = opts.legacy
    ? mapLegacyProfileRole(row.role)
    : isAccountRole(row.account_role)
      ? row.account_role
      : null;

  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    avatar_url: row.avatar_url,
    role: row.role,
    beta_features: row.beta_features ?? [],
    account_id: opts.legacy ? opts.userId : (row.account_id ?? null),
    account_role: accountRole,
  };
}
