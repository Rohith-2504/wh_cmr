import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined

export function createClient(): SupabaseClient {
  if (browserClient) return browserClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    // Return a recursively chainable Proxy during build time to avoid crashes
    // when environment variables are not populated.
    const createProxy = (): any => {
      const target = () => {};
      return new Proxy(target, {
        get(_, prop) {
          if (prop === 'then') return undefined;
          if (prop === 'auth') {
            return new Proxy({}, {
              get(_, authProp) {
                if (authProp === 'onAuthStateChange') {
                  return () => ({ data: { subscription: { unsubscribe: () => {} } } });
                }
                return () => Promise.resolve({ data: {}, error: null });
              }
            });
          }
          return createProxy();
        },
        apply() {
          return createProxy();
        }
      });
    };
    return createProxy();
  }

  browserClient = createBrowserClient(url, key)

  return browserClient
}
