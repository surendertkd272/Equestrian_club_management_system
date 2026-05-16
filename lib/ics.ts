// Minimal RFC 5545 iCalendar (.ics) builder. No npm dep — we generate a
// small, well-formed VCALENDAR with VEVENT children. Calendar apps
// (Google Calendar, Apple Calendar, Outlook) consume this directly.
//
// Use:
//   const ics = buildIcs({
//     prodId: "Equiwings",
//     calName: "My Lessons",
//     events: [{ uid, title, start, end, description, location, url }],
//   });
//   return new Response(ics, { headers: { "Content-Type": "text/calendar" }});

export type IcsEvent = {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  url?: string;
  status?: "CONFIRMED" | "CANCELLED" | "TENTATIVE";
};

// RFC 5545 requires UTC stamps in YYYYMMDDTHHMMSSZ format.
function fmt(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// Lines over 75 octets must be folded with CRLF + space. Most consumers
// tolerate unfolded lines, but Outlook is finicky — we fold defensively.
function fold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (i === 0) {
      out.push(line.slice(0, 75));
      i = 75;
    } else {
      out.push(" " + line.slice(i, i + 74));
      i += 74;
    }
  }
  return out.join("\r\n");
}

// RFC 5545 §3.3.11 — escape commas, semicolons, backslashes, newlines.
function esc(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function buildIcs(opts: {
  prodId: string;
  calName: string;
  events: IcsEvent[];
}): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push(fold(`PRODID:-//${esc(opts.prodId)}//EN`));
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  lines.push(fold(`X-WR-CALNAME:${esc(opts.calName)}`));

  const now = fmt(new Date());
  for (const e of opts.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(fold(`UID:${e.uid}`));
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${fmt(e.start)}`);
    lines.push(`DTEND:${fmt(e.end)}`);
    lines.push(fold(`SUMMARY:${esc(e.title)}`));
    if (e.description) lines.push(fold(`DESCRIPTION:${esc(e.description)}`));
    if (e.location) lines.push(fold(`LOCATION:${esc(e.location)}`));
    if (e.url) lines.push(fold(`URL:${esc(e.url)}`));
    if (e.status) lines.push(`STATUS:${e.status}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
