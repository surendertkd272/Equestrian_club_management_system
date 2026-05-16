import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotForm } from "./form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            We'll email a one-time link if your address is on file. Link expires in 30 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotForm />
          <div className="mt-4 text-center text-xs text-muted-foreground">
            <Link href="/login" className="hover:underline">← Back to sign in</Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
