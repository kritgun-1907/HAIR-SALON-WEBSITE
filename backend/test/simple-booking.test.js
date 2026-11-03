/**
 * @file test/simple-booking.test.js
 * @description The simple booking form (D73).
 *
 * What must hold: the owner's switch is off by default, can be turned on and off from Website -> Settings, and the
 * website sees it; a booking from the form (name, phone, day, time, what they want in their own words) makes an
 * UNPAID "requested" booking with no services, no OTP, no payment and no held slot, and sends the existing
 * request_received WhatsApp; the same form on an offer page records the offer; bad times and spam are refused; and
 * reception's Confirm and Decline answer it on WhatsApp like a WhatsApp-ad request, confirming for the default hour
 * without blocking the artist's calendar (and saying so).
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const { startDb, stopDb, clearDb } = require("./helpers/db");
const time = require("../utils/time");

process.env.TELEGRAM_BOT_TOKEN = "";
process.env.META_WA_TOKEN = "";
process.env.PUBLIC_TOKEN_SECRET = "t";

let Artist, artist, Service, Appointment, Customer, Campaign, NotificationLog, SlotLock, OtpChallenge, SiteSettings, svc;
let server;
let base;
let caller;
let ip;
let ipN = 0;

before(async () => {
  await startDb();
  Service = require("../models/Service");
  Artist = require("../models/Artist");
  Appointment = require("../models/Appointment");
  Customer = require("../models/Customer");
  Campaign = require("../models/Campaign");
  NotificationLog = require("../models/NotificationLog");
  SlotLock = require("../models/SlotLock");
  OtpChallenge = require("../models/OtpChallenge");
  SiteSettings = require("../models/SiteSettings");
  await Promise.all([Campaign, Appointment, Customer].map((m) => m.init()));

  const app = express();
  app.use(express.json());
  app.use("/api/public", require("../routes/public"));
  app.use((req, _res, next) => {
    req.session = { ...caller };
    next();
  });
  app.use("/api/bookings", require("../routes/bookings"));
  app.use("/api/website", require("../routes/website"));
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await stopDb();
});

const OWNER = { userId: new mongoose.Types.ObjectId(), name: "Owner", role: "owner" };

async function call(method, path, data) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const post = (path, data) => call("POST", path, data);

async function openDay(min = 3) {
  const s = (await SiteSettings.getSingleton()).toObject();
  for (let n = min; n < min + 14; n++) {
    const d = time.addDays(time.salonDate(), n);
    if ((s.openingHours[time.weekdayKey(d)] || []).length && !s.holidays.includes(d)) return d;
  }
  throw new Error("no open day");
}
let DAY;
let phoneN;
const phone = () => `98${String(76500000 + ++phoneN)}`;
const book = (over = {}) => post("/public/requests/simple", { name: "Asha Kaur", phone: phone(), date: DAY, time: "11:00", wants: "Hair spa and a blow dry", ...over });
const apptOf = async (r) => Appointment.findOne({ ref: r.body.ref }).lean();

beforeEach(async () => {
  await clearDb();
  caller = OWNER;
  ip = `10.2.${Math.floor(++ipN / 250)}.${ipN % 250}`;
  phoneN = 0;
  svc = await Service.create({ name: "Hair Spa", price: 1600, publicPrice: 800, slug: "hair-spa", isActive: true, showOnWebsite: true, bookingMode: "request", audience: "her", displayCategory: "Hair", durationMinutes: 60, durationConfirmed: true });
  await SiteSettings.getSingleton();
  artist = await Artist.create({ name: "Mansi Kumari", phone: "9888800001", commission: 40, gender: "female" });
  DAY = await openDay();
});

// ─── the switch ─────────────────────────────────────────────────────────────

test("the switch: off by default, the owner turns it on and off in Website settings, and the website sees it", async () => {
  assert.equal((await call("GET", "/public/site")).body.simpleBooking, false);
  assert.equal((await call("PATCH", "/website/settings", { simpleBooking: true })).status, 200);
  assert.equal((await SiteSettings.getSingleton()).simpleBooking, true);
  assert.equal((await call("GET", "/public/site")).body.simpleBooking, true);
  assert.equal((await call("PATCH", "/website/settings", { simpleBooking: "yes" })).status, 400, "only true or false");
  assert.equal((await call("PATCH", "/website/settings", { simpleBooking: false })).status, 200);
  assert.equal((await call("GET", "/public/site")).body.simpleBooking, false);
});

// ─── the booking ────────────────────────────────────────────────────────────

test("a booking from the form: unpaid, no services, no OTP, no payment, no held slot; their words kept; WhatsApp sent", async () => {
  const r = await book({ phone: "+91 98765 00001" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ["date", "duplicate", "ref", "status", "time"], "no price, nothing else");
  const a = await apptOf(r);
  assert.deepEqual([a.mode, a.status, a.source.channel, a.contact], ["request", "requested", "simple", "9876500001"]);
  assert.deepEqual([a.requestedWindow.date, a.requestedWindow.time, a.requestedWindow.window], [DAY, "11:00", "morning"]);
  assert.equal(a.notes, "Hair spa and a blow dry");
  assert.equal(a.guests.length, 1);
  assert.equal(a.guests[0].items.length, 0);
  assert.deepEqual([a.deposit.status, a.deposit.amount, a.pricing.total], ["none", 0, 0]);
  assert.equal(a.startAt, null);
  assert.ok(a.manageTokenHash, "the 'view your booking' link works from the first message");
  assert.equal(await SlotLock.countDocuments(), 0);
  assert.equal(await OtpChallenge.countDocuments(), 0);
  const c = await Customer.findOne({ phone: a.contact }).lean();
  assert.equal(c.marketing.whatsappOptIn, false, "booking is not agreeing to promotions");
  const sent = await NotificationLog.findOne({ key: `${a._id}:request_received` }).lean();
  assert.ok(sent, "the approved request_received WhatsApp is sent");
  assert.equal(sent.to, a.contact);
});

test("the box is optional, and limited to 300 characters", async () => {
  const r = await book({ wants: undefined });
  assert.equal(r.status, 201);
  assert.equal((await apptOf(r)).notes, null);
  assert.equal((await book({ wants: "x".repeat(301) })).status, 400);
});

test("name, phone, day and time are required; unknown fields (a price, a status) are refused", async () => {
  assert.equal((await book({ name: "" })).status, 400);
  assert.equal((await book({ phone: "12345" })).status, 400);
  assert.equal((await book({ date: undefined })).status, 400);
  assert.equal((await book({ time: undefined })).status, 400);
  assert.equal((await book({ price: 1 })).status, 400);
  assert.equal((await book({ status: "confirmed" })).status, 400);
  assert.equal(await Appointment.countDocuments(), 0);
});

test("times that cannot work are refused: past, closed, off the grid, too late for an hour", async () => {
  const s = (await SiteSettings.getSingleton()).toObject();
  assert.equal((await book({ date: time.addDays(time.salonDate(), -1) })).status, 400);
  assert.equal((await book({ time: "11:10" })).status, 400);
  const close = s.openingHours[time.weekdayKey(DAY)].at(-1).close;
  const lastHour = `${String(Number(close.slice(0, 2)) - 1).padStart(2, "0")}:${close.slice(3)}`;
  const tooLate = `${String(Number(close.slice(0, 2)) - 1).padStart(2, "0")}:${String(Number(close.slice(3)) + 15).padStart(2, "0")}`;
  assert.equal((await book({ time: lastHour })).status, 201, "an hour before closing still fits");
  assert.equal((await book({ time: tooLate })).status, 400);
  const closedDay = await (async () => {
    for (let n = 1; n < 14; n++) {
      const d = time.addDays(time.salonDate(), n);
      if (!(s.openingHours[time.weekdayKey(d)] || []).length) return d;
    }
    return null;
  })();
  if (closedDay) assert.equal((await book({ date: closedDay })).status, 400);
});

test("the same phone, day and time again is the first booking back; the honeypot stores nothing", async () => {
  const first = await book({ phone: "9876500009" });
  const again = await book({ phone: "098765 00009" });
  assert.equal(again.status, 200);
  assert.equal(again.body.ref, first.body.ref);
  assert.equal(again.body.duplicate, true);
  const bot = await book({ website: "http://spam" });
  assert.equal(bot.status, 201);
  assert.equal(await Appointment.countDocuments(), 1);
  assert.equal(await NotificationLog.countDocuments({ type: "request_received" }), 1);
});

test("limits: 3 new bookings per phone a day", async () => {
  const p = "9876500077";
  for (const t of ["11:00", "12:00", "13:00"]) assert.equal((await book({ phone: p, time: t })).status, 201);
  assert.equal((await book({ phone: p, time: "14:00" })).status, 429);
});

test("on an offer page: the same form records the live offer; an offer that is not running is ignored, the booking still counts", async () => {
  const today = time.salonDate();
  const offer = (slug, start, end) =>
    call("POST", "/website/campaigns", {
      name: `Offer ${slug}`,
      startDate: start,
      endDate: end,
      content: { headline: "Glow week", ctaHref: `/offers/${slug}` },
      page: { slug, headline: "Glow week", price: 999, priceNote: "for both", serviceIds: [String(svc._id)] },
    });
  assert.equal((await offer("glow", today, time.addDays(today, 5))).status, 201);
  assert.equal((await offer("gone", time.addDays(today, -9), time.addDays(today, -2))).status, 201);

  const a = await apptOf(await book({ offerSlug: "glow" }));
  assert.deepEqual([a.source.channel, a.source.offerSlug, a.source.offerHeadline, a.source.offerPrice, a.source.campaign], ["simple", "glow", "Glow week", 999, "glow"]);
  assert.equal(a.pricing.discount, 0, "no discount applied: reception gives it at billing");
  const b = await book({ offerSlug: "gone", time: "12:00" });
  assert.equal(b.status, 201);
  assert.equal((await apptOf(b)).source.offerSlug, null);
});

test("the customer's link shows the day and time asked for and what they typed", async () => {
  const tokens = require("../utils/bookingToken");
  const a = await apptOf(await book());
  const v = await call("GET", `/public/booking/${tokens.manageToken(a._id)}`);
  assert.equal(v.status, 200);
  assert.deepEqual(v.body.booking.requestedFor, { date: DAY, time: "11:00" });
  assert.equal(v.body.booking.wants, "Hair spa and a blow dry");
});

// ─── reception ──────────────────────────────────────────────────────────────

test("staff list: it shows as an unpaid simple-form request with the customer's words", async () => {
  await book();
  const r = (await call("GET", "/bookings/requests?status=requested")).body.requests[0];
  assert.deepEqual([r.channel, r.unpaid, r.notes, r.requestedWindow.time], ["simple", true, "Hair spa and a blow dry", "11:00"]);
});

test("Confirm sends booking_confirmed, books the default hour, and says the artist's calendar is not blocked", async () => {
  const a = await apptOf(await book());
  const r = await call("POST", `/bookings/${a._id}/confirm`, { artistId: String(artist._id), date: DAY, time: "12:30" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const done = await Appointment.findById(a._id).lean();
  assert.equal(done.status, "confirmed");
  assert.equal(done.endAt - done.startAt, 60 * 60_000, "the default hour");
  assert.match(done.noLockReason, /no services from the list/);
  assert.equal(await SlotLock.countDocuments(), 0);
  const log = await NotificationLog.findOne({ key: `${a._id}:booking_confirmed` }).lean();
  assert.ok(log, "the customer is told on WhatsApp");
  assert.match(log.params.when, /12:30 pm/i);
});

test("Decline sends request_declined (no refund wording)", async () => {
  const a = await apptOf(await book());
  assert.equal((await call("POST", `/bookings/${a._id}/decline`, { reason: "Fully booked" })).status, 200);
  assert.equal(await NotificationLog.countDocuments({ appointmentId: a._id, type: "request_declined" }), 1);
  assert.equal(await NotificationLog.countDocuments({ type: "booking_declined" }), 0);
});

test("the full booking flows are untouched: the WhatsApp-ad request still works the same", async () => {
  const r = await post("/public/requests/wa", { services: [String(svc._id)], date: DAY, time: "11:00", name: "Asha Kaur", phone: phone() });
  assert.equal(r.status, 201);
  const a = await apptOf(r);
  assert.deepEqual([a.source.channel, a.pricing.total, a.guests[0].items.length], ["wa_ad", 800, 1]);
});
