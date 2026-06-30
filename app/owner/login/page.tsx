import Link from "next/link";
import { OwnerLoginForm } from "./form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function OwnerLoginPage({ searchParams }: { searchParams: { next?: string } }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <Card className="w-full max-w-sm border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle>Platform owner</CardTitle>
          <CardDescription className="text-slate-400">
            Sign in to manage all tenants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OwnerLoginForm next={searchParams.next ?? "/owner"} devMode={process.env.NODE_ENV !== "production"} />
          <div className="mt-3 text-center text-xs">
            <Link href="/owner/forgot-password" className="text-slate-400 hover:text-slate-200 hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="mt-6 rounded-md border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
            <div className="font-semibold text-slate-200">Seed credentials</div>
            <ul className="mt-1 space-y-0.5">
              <li><code>owner@platform.local</code> / <code>password</code></li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
