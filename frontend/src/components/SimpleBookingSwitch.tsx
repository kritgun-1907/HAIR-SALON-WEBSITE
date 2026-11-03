/**
 * @file SimpleBookingSwitch.tsx
 * @description "Simple booking form: On / Off" — the switch at the top of Website Settings (D73).
 *
 * On: every "Book" button on the website and every live offer page shows ONE short form — day, time, name,
 * mobile and a box for the service they want in their own words. No OTP, no payment; the customer gets a
 * WhatsApp that we have their booking, and it lands in Bookings → Website Requests (marked "Simple form") for
 * reception to confirm or decline. Off: the full booking sheet and the offer pages' own forms, exactly as before.
 *
 * Saved on tap, separately from the page's Save button (it sends only this field, so nothing else changes).
 * The server audits every change and refreshes the website; it shows on the site within a minute or two.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const API = import.meta.env.VITE_BACKEND_URL || "";

export default function SimpleBookingSwitch() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${API}/api/website/settings`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => live && setOn(d.simpleBooking === true))
      .catch(() => {}); // the page above shows its own load error
    return () => {
      live = false;
    };
  }, []);

  if (on === null) return null;

  async function change(next: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API}/api/website/settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simpleBooking: next }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not change the setting");
      setOn(d.simpleBooking === true);
      setMsg({ ok: true, text: next ? "Simple form is on. The website switches over within a minute or two." : "Simple form is off. The full booking is back within a minute or two." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not change the setting" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`rounded-xl border shadow-sm p-5 mb-5 ${on ? "bg-emerald-50/60 border-emerald-200" : "bg-white border-stone-200/80"}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-stone-900">Simple booking form</h3>
          <p className="text-xs text-stone-500 mt-1 max-w-xl">
            On: every booking button and every offer page on the website shows one short form — day, time, name, mobile and what they want in their own words.
            No code, no payment. The customer gets a WhatsApp that we have their booking; it appears in Website Requests (marked “Simple form”) for you to confirm.
            Off: the full booking, as before.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Simple booking form"
          disabled={busy}
          onClick={() => change(!on)}
          className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-emerald-600" : "bg-stone-300"}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm">
        {busy ? <Loader2 className="w-4 h-4 animate-spin text-stone-400" /> : null}
        <span className={on ? "font-semibold text-emerald-700" : "text-stone-500"}>{on ? "On" : "Off"}</span>
        {msg && <span className={msg.ok ? "text-emerald-700" : "text-red-600"}>· {msg.text}</span>}
      </div>
    </section>
  );
}
