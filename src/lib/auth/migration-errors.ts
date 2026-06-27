import type { PostgrestError } from '@supabase/supabase-js';

import { isMissingSchemaResourceError } from './profile-load';

/** User-facing hint when a settings feature needs a DB migration. */
export function migrationRequiredMessage(
  feature: string,
  migrationFile: string,
): string {
  return `${feature} requires ${migrationFile}. Apply it in Supabase SQL Editor or via \`supabase db push\`.`;
}

/** Map PostgREST "table/RPC not found" errors to an actionable message. */
export function schemaMigrationHint(
  error: PostgrestError | null | undefined,
  feature: string,
  migrationFile: string,
): string | null {
  if (!isMissingSchemaResourceError(error)) return null;
  return migrationRequiredMessage(feature, migrationFile);
}
