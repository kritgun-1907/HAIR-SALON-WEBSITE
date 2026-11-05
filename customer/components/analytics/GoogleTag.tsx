"use client";

/**
 * Google tag (gtag.js) for Google Ads. Mounted once in the root layout, like MetaPixel. The id comes from
 * NEXT_PUBLIC_GOOGLE_TAG_ID (AW-…); with it unset (local dev, preview deployments) nothing loads, so test
 * bookings never reach the ad account.
 *
 * The lead conversion fires on /book/confirmed (see `googleLead`), with the booking ref as transaction_id so
 * Google counts a refresh of that page once.
 */

import Script from "next/script";

const TAG_ID = process.env.NEXT_PUBLIC_GOOGLE_TAG_ID || "";
/** The conversion action's label: Google Ads → Goals → Conversions → the action → "Use Google tag" → send_to "AW-…/<label>". */
const LEAD_LABEL = process.env.NEXT_PUBLIC_GOOGLE_ADS_LEAD_LABEL || "";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/** Google Ads lead conversion for one booking. Queued on dataLayer, so it is sent even if gtag.js is still loading. */
export function googleLead(ref: string) {
  if (!TAG_ID || !LEAD_LABEL) return;
  // gtag.js reads the `arguments` object, not an array: this is the same function as in the base code.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function gtag(..._args: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    (window.dataLayer = window.dataLayer || []).push(arguments);
  }
  gtag("event", "conversion", { send_to: `${TAG_ID}/${LEAD_LABEL}`, transaction_id: ref });
}

export function GoogleTag() {
  if (!TAG_ID) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${TAG_ID}`} strategy="afterInteractive" />
      <Script id="google-tag" strategy="afterInteractive">{`
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${TAG_ID}');
`}</Script>
    </>
  );
}
