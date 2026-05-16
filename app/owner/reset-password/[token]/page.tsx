import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OwnerResetForm } from "./form";

export default function OwnerResetPasswordPage({ params }: { params: { token: string } }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <Card className="w-full max-w-sm border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle>Pick a new owner password</CardTitle>
          <CardDescription className="text-slate-400">
            Link is single-use and expires 30 minutes after it was sent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OwnerResetForm token={params.token} />
          <div className="mt-4 text-center text-xs text-slate-400">
            <Link href="/owner/login" className="hover:underline">
              Back to owner sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
