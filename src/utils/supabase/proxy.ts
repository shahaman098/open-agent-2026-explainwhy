import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function requestHeadersWithDemoKey(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  const demoMode = process.env.EXPLAINWHY_DEMO_MODE === "true";
  const demoKey = process.env.EXPLAINWHY_DEMO_KEY;
  if (
    demoMode &&
    demoKey &&
    request.nextUrl.pathname.startsWith("/api/") &&
    !headers.has("x-explainwhy-demo-key")
  ) {
    headers.set("x-explainwhy-demo-key", demoKey);
  }
  return headers;
}

export async function updateSession(request: NextRequest) {
  const forwardedHeaders = requestHeadersWithDemoKey(request);
  let supabaseResponse = NextResponse.next({ request: { headers: forwardedHeaders } });

  if (!supabaseUrl || !supabaseKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request: { headers: forwardedHeaders } });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) =>
          supabaseResponse.headers.set(key, value),
        );
      },
    },
  });

  await supabase.auth.getClaims();

  return supabaseResponse;
}
