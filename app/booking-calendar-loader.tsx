"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type BookingCalendarComponent from "./booking-calendar";

// The calendar renders only in the browser. Server-rendering it (mostly loading its code into a
// fresh Cloudflare isolate) took 50-120 ms of CPU per page load, over the free plan's 10 ms limit,
// and all of its data is fetched client-side anyway. Start the download as soon as this module
// runs, so the chunk arrives while the page hydrates instead of after it mounts.
const loadCalendar = () => import("./booking-calendar");
if (typeof window !== "undefined") void loadCalendar();

const BookingCalendar = dynamic(loadCalendar, { ssr: false, loading: CalendarPlaceholder });

export default function BookingCalendarLoader(props: ComponentProps<typeof BookingCalendarComponent>) {
  return <BookingCalendar {...props} />;
}

function CalendarPlaceholder() {
  return (
    <main className="app-shell" aria-busy="true">
      <header className="topbar">
        <div>
          <p className="eyebrow">Roomie</p>
          <h1>Listings</h1>
        </div>
      </header>
    </main>
  );
}
