"use client";

/**
 * SimpleBookingForm — the one short booking form (D73), used when the owner switches "Simple booking form" on in
 * the staff app (Website → Settings). The SAME form everywhere: inside the SimpleBookingSheet that every "Book"
 * button opens, on /book, and on a live offer page (which also sends its offer's address).
 *
 * Day, time, name, mobile and ONE box for the service they want (or anything else) in their own words. No menu,
 * no package, no price, no OTP and no payment. It goes to POST /api/public/requests/simple; the customer gets a
 * WhatsApp at once that we have their booking and will confirm it shortly, and reception calls or messages them.
 * On success the page moves to /book/confirmed, the thank-you page ads count leads on.
 *
 * What it sends is only what the customer typed; the server checks the time again and never takes a price from
 * here. The hidden "website" box is a trap for bots: people never see or fill it.
 */

import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { addDays, clock, dayParts, isOpenOn, todayIST } from "@/lib/format";
import { mobileDigits, nameOk } from "@/lib/leads";
import type { SiteInfo } from "@/lib/types";
import { pixelHeaders, track, trackOnce } from "@/lib/pixel";
import { readFirstTouch } from "@/components/UtmCapture";
import { timesFor } from "@/components/offers/WaRequestForm";

const DAYS_SHOWN = 14;
/** The service is not known yet: an hour is assumed, as the server does. */
const MINUTES_ASSUMED = 60;
const WANTS_MAX = 300;

interface Result {
  ref: string;
  date: string;
  time: string;
  duplicate: boolean;
}

export function SimpleBookingForm({
  site,
  offerSlug,
  campaign: campaignProp,
  initialPhone,
  onSent,
}: {
  site: SiteInfo;
  /** On an offer page: the offer's address, so the desk knows which offer to apply. */
  offerSlug?: string | null;
  /** Ad tag. When not given, it is read from the page address (?c=karwa). The server tidies it again. */
  campaign?: string | null;
  initialPhone?: string;
  /** Called once the booking has gone through, as the page moves to /book/confirmed (the sheet closes and starts fresh). */
  onSent?: () => void;
}) {
  const params = useSearchParams();
  const campaign = campaignProp ?? params.get("c");
  const days = useMemo(() => {
    const today = todayIST();
    return Array.from({ length: DAYS_SHOWN + 1 }, (_, i) => addDays(today, i)).filter((d) => isOpenOn(site, d) && timesFor(site, d, MINUTES_ASSUMED).length > 0);
  }, [site]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState((initialPhone ?? params.get("p") ?? "").replace(/\D/g, "").slice(-10));
  const [wants, setWants] = useState("");
  const [trap, setTrap] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const times = date ? timesFor(site, date, MINUTES_ASSUMED) : [];
  const digits = mobileDigits(phone);
  const ready = Boolean(date && time && nameOk(name) && digits) && !sending;

  // Meta Pixel: the first touch inside the form is the booking STARTED, once per form.
  const started = useRef(false);
  function markStarted() {
    if (started.current) return;
    started.current = true;
    track("InitiateCheckout", { content_name: offerSlug ?? campaign ?? "Simple booking" });
  }

  async function submit() {
    setSending(true);
    setError("");
    const utm = readFirstTouch();
    try {
      const res = await fetch("/api/public/requests/simple", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...pixelHeaders() },
        body: JSON.stringify({
          name: name.trim(),
          phone: digits,
          date,
          time,
          ...(wants.trim() ? { wants: wants.trim() } : {}),
          ...(offerSlug ? { offerSlug } : {}),
          ...(campaign ? { campaign } : {}),
          ...(utm ? { utm } : {}),
          website: trap,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "That didn't go through. Try again, or message us on WhatsApp.");
        return;
      }
      const r = data as Result;
      if (!r.duplicate) trackOnce("Lead", r.ref, { content_name: offerSlug ?? "Simple booking" });
      // Its own page so ads can count the lead. A FULL page load, not router.push: Google Ads counts the lead on a page
      // load of /book/confirmed and may not see a client-side route change. No name or phone in the address. Meta's Lead
      // above may be cut short by the load; the server sends it too (Conversions API).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/book/confirmed?${new URLSearchParams({ ref: r.ref, date: r.date, time: r.time, ...(r.duplicate ? { dup: "1" } : {}) })}`);
      onSent?.();
    } catch {
      setError("You seem to be offline. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  const field = "mt-2 h-12 w-full rounded-[var(--radius-control)] border border-line bg-ivory px-4 text-[16px] outline-none focus:border-gold-deep";
  const label = "block text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-muted";

  return (
    <form
      className="space-y-6"
      onPointerDownCapture={markStarted}
      onFocusCapture={markStarted}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void submit();
      }}
    >
      <fieldset className="min-w-0">
        <legend className={label}>Day</legend>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => {
            const p = dayParts(d);
            const on = d === date;
            return (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDate(d);
                  setTime("");
                }}
                aria-pressed={on}
                className={`min-w-[64px] shrink-0 rounded-[var(--radius-control)] border px-3 py-2 text-center ${on ? "border-ink bg-ink text-ivory" : "border-line bg-ivory hover:bg-ivory-2"}`}
              >
                <span className="block text-[12px] uppercase">{p.weekday}</span>
                <span className="block text-[20px] font-semibold tabular">{p.day}</span>
                <span className="block text-[12px]">{p.month}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {date && (
        <fieldset className="min-w-0">
          <legend className={label}>Time</legend>
          {times.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {times.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTime(t)}
                  aria-pressed={t === time}
                  className={`h-11 rounded-full border px-4 text-[15px] tabular ${t === time ? "border-ink bg-ink text-ivory" : "border-line bg-ivory hover:bg-ivory-2"}`}
                >
                  {clock(t)}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[15px] text-ink-muted">No more times that day. Pick another day.</p>
          )}
        </fieldset>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <label className={label}>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} className={field} />
        </label>
        <label className={label}>
          Mobile number
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel-national" placeholder="10-digit WhatsApp number" className={field} />
        </label>
      </div>

      <label className={`${label} block`}>
        Service you want, or anything else (optional)
        <textarea
          value={wants}
          onChange={(e) => setWants(e.target.value)}
          maxLength={WANTS_MAX}
          rows={3}
          placeholder="e.g. Haircut and hair spa. Bridal makeup trial. Two of us are coming."
          className="mt-2 w-full rounded-[var(--radius-control)] border border-line bg-ivory px-4 py-3 text-[16px] outline-none focus:border-gold-deep"
        />
      </label>

      {/* Bot trap: invisible to people (off-screen, not focusable, ignored by password managers). */}
      <div aria-hidden className="pointer-events-none absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden opacity-0">
        <label>
          Website
          <input value={trap} onChange={(e) => setTrap(e.target.value)} tabIndex={-1} autoComplete="off" name="website" className="h-0 w-0 border-0 p-0" />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-[15px] text-danger">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={!ready}>
        {sending ? "Sending…" : "Book appointment"}
      </Button>
      <p className="text-[13px] leading-[1.5] text-ink-muted">
        No payment and no code needed. We confirm your booking on WhatsApp and you pay at the salon after your visit. By sending this you agree that we message you on
        WhatsApp about this visit only.
      </p>
    </form>
  );
}
