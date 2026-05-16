import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Public QR landing. Sends authenticated staff straight to the asset detail page.
// Unauthenticated visitors are bounced through /login with the deep link preserved.
export default async function ScanLanding({ params }: { params: { code: string } }) {
  const session = await getSession();
  const asset = await prisma.asset.findUnique({
    where: { qrCode: params.code },
    select: { id: true, name: true, qrCode: true, centreId: true },
  });

  if (!asset) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow">
          <div className="text-sm font-bold uppercase tracking-wider text-destructive">Unknown code</div>
          <p className="mt-2 text-sm text-muted-foreground">
            No asset matches <code className="font-mono">{params.code}</code>. The sticker may be from another centre or
            a retired item.
          </p>
        </div>
      </main>
    );
  }

  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/tack/by-code/${params.code}`)}`);
  }

  if (session.role !== "SUPER_ADMIN" && asset.centreId !== session.centreId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow">
          <div className="text-sm font-bold uppercase tracking-wider text-destructive">Wrong centre</div>
          <p className="mt-2 text-sm text-muted-foreground">
            <b>{asset.name}</b> belongs to another centre and isn't visible from your account.
          </p>
        </div>
      </main>
    );
  }

  redirect(`/tack/${asset.id}`);
}
