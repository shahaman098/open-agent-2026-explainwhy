import { NextResponse } from "next/server";

import { createClient } from "@/utils/supabase/server";

export async function GET() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL
    || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return NextResponse.json(
      { ok: false, error: "supabase_env_missing" },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  return NextResponse.json({
    ok: !error,
    authenticated: Boolean(data?.claims),
    projectUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
}
