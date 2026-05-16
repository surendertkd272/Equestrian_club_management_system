import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetForm } from "./form";

export default function ResetPasswordPage({ params }: { params: { token: string } }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Pick a new password</CardTitle>
          <CardDescription>
            Link is single-use and expires 30 minutes after it was sent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResetForm token={params.token} />
          <div className="mt-4 text-center text-xs text-muted-foreground">
            <Link href="/login" className="hover:underline">Back to sign in</Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
