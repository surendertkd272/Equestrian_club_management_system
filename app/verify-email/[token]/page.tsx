import { redeemEmailVerifyToken } from "@/lib/email-verify";
import { audit } from "@/lib/audit";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";

// Public verification landing. Server-component does the token redeem
// directly so we don't ship the plaintext token back to the client and
// the user can't refresh-replay it. The token is single-use either way.
export default async function VerifyEmailPage({ params }: { params: { token: string } }) {
  const result = await redeemEmailVerifyToken(params.token);
  if (result.ok) {
    await audit({
      userId: result.userId,
      action: "auth.email_verified",
      tableName: "user",
      rowId: result.userId,
      after: { email: result.email, via: "page" },
    });
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {result.ok ? (
              <>
                <CheckCircle className="h-5 w-5 text-emerald-600" />
                Email verified
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5 text-rose-600" />
                Couldn't verify
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {result.ok ? (
            <>
              <p>Your email <strong>{result.email}</strong> is now confirmed.</p>
              <p>
                You can <Link href="/login" className="text-primary underline">sign in</Link> and use all account features.
              </p>
            </>
          ) : (
            <>
              <p>
                {result.error === "TOKEN_EXPIRED"
                  ? "This verification link has expired."
                  : result.error === "TOKEN_USED"
                    ? "This link has already been used."
                    : "We couldn't verify this link. It may be invalid or tampered."}
              </p>
              <p>
                <Link href="/login" className="text-primary underline">Sign in</Link> and request a new
                verification link from your account page.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
