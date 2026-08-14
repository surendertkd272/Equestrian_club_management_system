import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignupForm } from "./form";

export const metadata: Metadata = {
  title: "Start your club — Equiwings",
  description: "Create your riding club's account and start a 14-day trial.",
};

// Public self-serve registration. Complements the owner-operated wizard at
// /owner/tenants/new rather than replacing it: a hands-on sale still wants the
// owner filling in plan, slugs and billing details, while a club that finds the
// pricing page can now start on its own instead of composing an email.
export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <picture>
            <source srcSet="/equiwings-logo.png" type="image/png" />
            <img src="/equiwings-logo.svg" alt="Equiwings" className="mx-auto mb-2 h-14 w-auto" />
          </picture>
          <CardTitle>Start your club</CardTitle>
          <CardDescription>
            14-day trial. No card needed. You&apos;ll be the club&apos;s administrator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
        </CardContent>
      </Card>
    </main>
  );
}
