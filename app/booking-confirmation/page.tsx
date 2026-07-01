// Public venue booking confirmation page. Reads booking details from
// query params set by the admin when generating the short link.
// Designed to be shared via WhatsApp; recipient sees what they've booked
// + a tap-to-add-to-calendar (Google Calendar event creation link).

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "lucide-react";

export const dynamic = "force-dynamic";

export default function BookingConfirmationPage({
  searchParams,
}: {
  searchParams: {
    facility?: string;
    centre?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    bookedBy?: string;
    notes?: string;
  };
}) {
  const facility = searchParams.facility ?? "Facility";
  const centre = searchParams.centre;
  const date = searchParams.date;
  const startTime = searchParams.startTime;
  const endTime = searchParams.endTime;
  const bookedBy = searchParams.bookedBy;

  // Build a Google Calendar "add event" URL — tapping it on a phone opens
  // Calendar with the event pre-filled. Falls back gracefully if dates
  // are missing.
  let calLink: string | null = null;
  if (date && startTime && endTime) {
    try {
      const start = new Date(`${date}T${startTime}:00`);
      const end = new Date(`${date}T${endTime}:00`);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const fmt = (d: Date) =>
          d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
        const params = new URLSearchParams({
          action: "TEMPLATE",
          text: `${facility} booking · ${centre ?? ""}`.trim(),
          dates: `${fmt(start)}/${fmt(end)}`,
          details: searchParams.notes ?? "",
          location: centre ?? "",
        });
        calLink = `https://www.google.com/calendar/render?${params.toString()}`;
      }
    } catch {
      // Bad date params — skip the calendar button.
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Booking Confirmed</CardTitle>
          <CardDescription>
            Your facility booking with {centre ?? "the club"} is confirmed. Show this page on
            arrival.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <dl className="grid grid-cols-3 gap-y-2">
            <dt className="text-muted-foreground">Facility</dt>
            <dd className="col-span-2 font-medium">{facility}</dd>
            {centre && (
              <>
                <dt className="text-muted-foreground">Centre</dt>
                <dd className="col-span-2">{centre}</dd>
              </>
            )}
            {date && (
              <>
                <dt className="text-muted-foreground">Date</dt>
                <dd className="col-span-2">{date}</dd>
              </>
            )}
            {startTime && endTime && (
              <>
                <dt className="text-muted-foreground">Time</dt>
                <dd className="col-span-2">{startTime} – {endTime}</dd>
              </>
            )}
            {bookedBy && (
              <>
                <dt className="text-muted-foreground">Booked by</dt>
                <dd className="col-span-2">{bookedBy}</dd>
              </>
            )}
            {searchParams.notes && (
              <>
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="col-span-2">{searchParams.notes}</dd>
              </>
            )}
          </dl>
          {calLink && (
            <a
              href={calLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border-2 border-primary bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
            >
              <Calendar className="h-4 w-4" />
              Add to Calendar
            </a>
          )}
          <p className="text-xs text-muted-foreground">
            Payment has already been collected. If anything looks wrong, reply to the WhatsApp
            message you received with this link.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
