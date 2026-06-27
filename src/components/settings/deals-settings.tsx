"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Coins, Loader2, CircleAlert } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { migrationRequiredMessage } from "@/lib/auth/migration-errors";
import { CURRENCIES } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Deals settings — account-wide default currency.
 *
 * One currency per account (issue #218): the chosen code seeds new
 * deals and formats every aggregated total. Existing deals keep their
 * own saved currency. Writes go straight to `accounts.default_currency`;
 * the `accounts_update` RLS policy (017) already restricts that to
 * admins+, so non-admins see a disabled, read-only control.
 */
export function DealsSettings() {
  const {
    accountId,
    defaultCurrency,
    canEditSettings,
    profileLoading,
    legacyAccountSharing,
    refreshProfile,
  } = useAuth();

  const [selected, setSelected] = useState(defaultCurrency);
  const [saving, setSaving] = useState(false);

  // Keep the select in sync once the profile (and its account default)
  // resolves, and after a save round-trips through refreshProfile.
  useEffect(() => {
    setSelected(defaultCurrency);
  }, [defaultCurrency]);

  const dirty = selected !== defaultCurrency;

  async function handleSave() {
    if (!accountId || !dirty) return;
    setSaving(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_currency: selected }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        toast.error(payload.error || "Failed to save default currency");
        return;
      }
      // Pull the new value back into the auth context so the deal form
      // and every total pick it up without a full reload.
      await refreshProfile();
      toast.success("Default currency updated");
    } catch {
      toast.error("Could not reach the server. Try again?");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Deals & currency"
        description="The currency used for new deals and for pipeline and dashboard totals."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Coins className="size-4 text-primary" />
            Default currency
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            New deals default to this currency, and pipeline and
            dashboard totals are shown in it. Existing deals keep the
            currency they were saved with.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {legacyAccountSharing ? (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {migrationRequiredMessage(
                  "Account-wide currency",
                  "supabase/migrations/017_account_sharing.sql and 021_account_default_currency.sql",
                )}
              </span>
            </p>
          ) : null}
          <div className="grid gap-2 sm:max-w-xs">
            <Label className="text-muted-foreground">Currency</Label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!canEditSettings || profileLoading || legacyAccountSharing}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.label}
                </option>
              ))}
            </select>
            {!canEditSettings && (
              <p className="text-xs text-muted-foreground">
                Only account admins can change the default currency.
              </p>
            )}
          </div>

          {canEditSettings && !legacyAccountSharing && (
            <Button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
