"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { googleLead } from "@/components/analytics/GoogleTag";
import { clock, dayParts, whatsappHref } from "@/lib/format";

export function Confirmed({ whatsapp }: { whatsapp: string | null }) {
  const params = useSearchParams();
  // The address can be typed by anyone: show only values in the shape the form sends.
  const ref = /^[\w-]{1,40}$/.test(params.get("ref") ?? "") ? params.get("ref")! : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : "";
  const time = /^\d{2}:\d{2}$/.test(params.get("time") ?? "") ? params.get("time")! : "";
  const duplicate = params.get("dup") === "1";

  useEffect(() => {
    if (ref && !duplicate) googleLead(ref);
  }, [ref, duplicate]);

  const wa = whatsappHref(whatsapp, ref ? `Hi, about my booking ${ref}.` : "Hi, about my booking.");
  return (
    <div role="status" className="rounded-[var(--radius-card)] border border-line bg-ivory-2 p-6 md:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">{duplicate ? "Already with us" : "Booking received"}</p>
      <h1 className="mt-3 font-serif text-[30px] leading-tight md:text-[38px]">Thank you.</h1>
      <p className="mt-3 text-[16px] leading-[1.6]">
        {date && time ? (
          <>
            We have your booking for <b>{dayParts(date).long}</b> at <b>{clock(time)}</b>.
          </>
        ) : (
          "We have your booking."
        )}{" "}
        We have sent you a WhatsApp, and our team will reach out to you shortly to confirm it. Nothing to pay now.
      </p>
      {ref && (
        <p className="mt-2 text-[14px] text-ink-muted">
          Your reference is <span className="font-mono">{ref}</span>.
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        {wa && (
          <Button variant="whatsapp" href={wa} target="_blank" rel="noreferrer">
            Message us on WhatsApp
          </Button>
        )}
        <Button variant="secondary" href="/">
          Back to home
        </Button>
      </div>
    </div>
  );
}
