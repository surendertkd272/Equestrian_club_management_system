import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyEmailForm } from "./form";

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Verify Your Email</CardTitle>
          <CardDescription>Enter the 6-digit code we emailed you. It expires in 10 minutes.</CardDescription>
        </CardHeader>
        <CardContent>
          <VerifyEmailForm />
          <div className="mt-4 text-center text-xs text-muted-foreground">
            <Link href="/login" className="hover:underline">← Back to sign in</Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
