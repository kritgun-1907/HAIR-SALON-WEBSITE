"use client";

/**
 * SimpleBookingSheet — what every "Book" button opens when the owner has switched the simple booking form on
 * (D73). One screen: the SimpleBookingForm (day, time, name, mobile, what they want). Same sheet shape as the
 * request and booking sheets (DS §4 `sheet`): up from the bottom on mobile, in from the right on desktop;
 * transform/opacity only, so reduced motion collapses it via the global rule. Escape closes it, focus moves
 * into it on open and back to the page on close.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { SiteInfo } from "@/lib/types";
import { useRequest } from "./RequestContext";
import { SimpleBookingForm } from "./SimpleBookingForm";

export function SimpleBookingSheet({ site }: { site: SiteInfo }) {
  const { isOpen: anyOpen, openedAt, close, kind } = useRequest();
  const isOpen = anyOpen && kind === "simple";
  /** A sent booking starts fresh next time; an unfinished one is kept while the sheet is closed. */
  const [formKey, setFormKey] = useState(0);

  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => panel.current?.focus());
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  const handleClose = useCallback(() => {
    close();
    returnFocus.current?.focus?.();
  }, [close]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, handleClose]);

  return (
    <div
      className={`fixed inset-0 z-50 transition-[visibility] duration-[330ms] ${isOpen ? "visible" : "invisible pointer-events-none"}`}
      aria-hidden={!isOpen}
      inert={!isOpen}
    >
      <div onClick={handleClose} className={`absolute inset-0 bg-ink/50 transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0"}`} />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Book an appointment"
        tabIndex={-1}
        className={`absolute bottom-0 left-0 right-0 flex max-h-[92dvh] flex-col rounded-t-[var(--radius-media)] bg-ivory text-ink outline-none transition-transform duration-[320ms] ease-[var(--ease-rise)]
          md:bottom-0 md:left-auto md:top-0 md:max-h-none md:w-[480px] md:rounded-none md:rounded-l-[var(--radius-card)]
          ${isOpen ? "translate-y-0 shadow-[var(--shadow-sheet)] md:translate-x-0" : "translate-y-full shadow-none md:translate-y-0 md:translate-x-full"}`}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 md:px-6">
          <span className="w-11" />
          <span className="flex-1 text-center text-[15px] font-semibold">Book an appointment</span>
          <button onClick={handleClose} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-ivory-2" aria-label="Close">
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
          {/* Mounted once opened, so "today" in the day strip is the visitor's today, never the build machine's. */}
          {openedAt && (
            <SimpleBookingForm
              key={formKey}
              site={site}
              onSent={() => {
                // The form has moved the page to /book/confirmed: close over it and start fresh next time.
                close();
                setFormKey((k) => k + 1);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
