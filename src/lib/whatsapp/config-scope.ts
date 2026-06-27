import type { AccountContext } from '@/lib/auth/account';

/** Which column scopes a `whatsapp_config` row for the current tenant. */
export type WhatsAppConfigScope = {
  column: 'account_id' | 'user_id';
  value: string;
};

/**
 * Resolve the tenancy column for `whatsapp_config` lookups.
 *
 * Pre migration 017 the table is keyed by `user_id` (one config per
 * auth user). Post-017 it is keyed by `account_id` (one config per
 * account). `getCurrentAccount()` sets `legacyAccountSharing` when
 * the extended profile columns are absent.
 */
export function getWhatsAppConfigScope(
  ctx: Pick<AccountContext, 'accountId' | 'userId' | 'legacyAccountSharing'>,
): WhatsAppConfigScope {
  if (ctx.legacyAccountSharing) {
    return { column: 'user_id', value: ctx.userId };
  }
  return { column: 'account_id', value: ctx.accountId };
}
