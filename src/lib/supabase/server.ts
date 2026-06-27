import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function createClient(): Promise<SupabaseClient> {
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
                if (authProp === 'getUser') {
                  return () => Promise.resolve({ data: { user: null } });
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

  const cookieStore = await cookies()

  return createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  )
}
