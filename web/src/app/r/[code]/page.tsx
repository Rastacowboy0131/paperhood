"use client";

// Referral landing: store the code and bounce to the screener. The code is
// claimed server-side after the visitor's first wallet sign-in.
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { storeRefCode } from "@/lib/referrals";

export default function ReferralLanding() {
  const params = useParams<{ code: string }>();
  const router = useRouter();

  useEffect(() => {
    const code = String(params?.code ?? "");
    if (code) storeRefCode(code);
    router.replace("/");
  }, [params, router]);

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-term-dim">
      Applying referral...
    </div>
  );
}
