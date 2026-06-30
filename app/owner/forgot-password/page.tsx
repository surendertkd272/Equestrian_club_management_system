import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OwnerForgotForm } from "./form";

export default function OwnerForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <Card className="w-full max-w-sm border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle>Owner password reset</CardTitle>
          <CardDescription className="text-slate-400">
            We'll email a one-time link if your owner address is on file. Expires in 30 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OwnerForgotForm />
          <div className="mt-4 text-center text-xs text-slate-400">
            <Link href="/owner/login" className="hover:underline">
              ← Back to owner sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
