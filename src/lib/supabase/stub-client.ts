import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

const CONFIG_ERROR_BODY = {
  name: "PostgrestError",
  message:
    "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
  details: "",
  hint: "",
  code: "CONFIG_MISSING",
} as const;

export const SUPABASE_CONFIG_ERROR: PostgrestError = {
  ...CONFIG_ERROR_BODY,
  toJSON() {
    return { ...CONFIG_ERROR_BODY };
  },
};

type QueryPayload<T> = { data: T; error: PostgrestError | null };

/**
 * Chainable, thenable PostgREST builder stub. Without this, the old
 * recursive Proxy returned truthy `error` objects with no message/code
 * fields — callers like AuthProvider logged `{}` and tripped the dev
 * overlay even though nothing useful failed.
 */
function createQueryResult<T>(data: T, error: PostgrestError | null) {
  const payload: QueryPayload<T> = { data, error };
  const builder = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === "then") {
        return (onFulfilled?: (value: QueryPayload<T>) => unknown) =>
          Promise.resolve(payload).then(onFulfilled);
      }
      if (
        prop === "maybeSingle" ||
        prop === "single" ||
        prop === "csv" ||
        prop === "geojson" ||
        prop === "explain" ||
        prop === "throwOnError"
      ) {
        return () => Promise.resolve(payload);
      }
      return () => builder;
    },
  }) as PromiseLike<QueryPayload<T>> & Record<string, unknown>;
  return builder;
}

/** Minimal Supabase client for build-time / missing-env fallbacks. */
export function createStubSupabaseClient(): SupabaseClient {
  const noop = () => {};
  const queryFail = () => createQueryResult(null, SUPABASE_CONFIG_ERROR);

  const authProxy = new Proxy(
    {},
    {
      get(_, authProp) {
        if (authProp === "onAuthStateChange") {
          return () => ({
            data: { subscription: { unsubscribe: noop } },
          });
        }
        if (authProp === "getUser") {
          return () =>
            Promise.resolve({ data: { user: null }, error: null });
        }
        if (authProp === "getSession") {
          return () =>
            Promise.resolve({ data: { session: null }, error: null });
        }
        if (authProp === "signOut") {
          return () => Promise.resolve({ error: null });
        }
        return () => Promise.resolve({ data: {}, error: null });
      },
    },
  );

  return new Proxy(noop, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      if (prop === "auth") return authProxy;
      if (prop === "from" || prop === "rpc") return () => queryFail();
      return createStubSupabaseClient();
    },
    apply() {
      return createStubSupabaseClient();
    },
  }) as unknown as SupabaseClient;
}
