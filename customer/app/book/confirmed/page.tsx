/**
 * `/book/confirmed?ref=…&date=…&time=…` — where the simple booking form (D73) lands after a booking goes through.
 * A page of its own, so Google Ads (and Meta) can count a lead by its address, and the Google Ads conversion fires
 * here once per booking ref (`dup=1`, a booking we already had, fires nothing).
 *
 * Only the ref, day and time are in the address: never the name or phone, which would leak into ad and analytics
 * reports. Kept out of search engines.
 */

import type { Metadata } from "next";
import { Suspense } from "react";
import { getSite } from "@/lib/api";
import { Confirmed } from "./Confirmed";

export const metadata: Metadata = {
  title: "Booking received",
  robots: { index: false, follow: false },
};

async function Body() {
  const site = await getSite();
  return <Confirmed whatsapp={site?.contact.whatsapp ?? null} />;
}

export default function ConfirmedPage() {
  return (
    <main className="mx-auto w-full max-w-[640px] px-4 py-16 md:px-0 md:py-24">
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </main>
  );
}
