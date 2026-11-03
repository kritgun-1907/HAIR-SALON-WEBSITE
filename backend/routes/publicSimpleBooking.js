/**
 * @file publicSimpleBooking.js
 * @description POST /api/public/requests/simple: the SIMPLE booking form (D73). Mounted inside /api/public.
 *
 * When the owner switches "Simple booking form" on (staff app, Website -> Settings; SiteSettings.simpleBooking),
 * every "Book" button on the website and every live offer page shows one short form instead of the full booking
 * sheet: name, mobile, day, time and ONE box where the customer types the service they want (or anything else).
 * It is the same form, sent here, whether it came from a normal booking button or an offer page; an offer page
 * also sends its offer's address so the desk knows which offer to apply.
 *
 * What it makes: an Appointment `{mode: "request", status: "requested", source.channel: "simple"}` with no
 * services on it (the customer's words are the booking note), nothing held, nothing charged, no OTP. The customer
 * gets the approved `request_received` WhatsApp at once ("we have received your booking request … and will
 * confirm it shortly"), and the owner is told on Telegram. Reception confirms or declines it in the staff app
 * (Bookings -> Website Requests) exactly like a WhatsApp-ad request, and the customer is told on WhatsApp.
 *
 * The route works whether the switch is on or off: the website keeps a cached copy of the switch for a minute or
 * two, and a customer who filled the form in that minute must not lose their booking.
 *
 * Spam controls, as for the WhatsApp-ad request (routes/publicWaRequest.js), since there is no OTP:
 *   - a honeypot box people never see: a bot that fills it gets a convincing "ok" and nothing is stored;
 *   - 10 requests per address per hour and 3 per phone per day (database-backed, shared by every instance),
 *     plus the salon's own cap of active bookings per phone;
 *   - phone numbers normalised so one person is one number, and the same phone asking for the same day and time
 *     again gets the first request back instead of a second one;
 *   - past, too-soon, closed-day, off-grid and too-late times are refused (an hour is assumed for the service);
 *   - only known fields: a price, a status or a consent flag cannot be sent in. No price is ever taken or shown.
 */

const express = require("express");
const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const Customer = require("../models/Customer");
const Appointment = require("../models/Appointment");
const SiteSettings = require("../models/SiteSettings");
const { DEFAULT_DURATION_MINUTES } = require("../models/Service");
const { mongoRateLimit, hit } = require("../middleware/mongoRateLimit");
const { alertNewRequest } = require("../utils/bookingAlerts");
const { isValidDate, salonDate } = require("../utils/time");
const { manageToken, hashManageToken } = require("../utils/bookingToken");
const wa = require("../utils/waRequest");
const offerPages = require("../utils/offerPages");
const metaCapi = require("../utils/metaCapi");
const { clientIp } = require("../utils/audit");
const { cleanUtm } = require("../utils/utm");

const router = express.Router();
const HOUR = 60 * 60 * 1000;
/** Same as a booking note (Appointment.notes). */
const WANTS_MAX = 300;
const FIELDS = new Set(["name", "phone", "date", "time", "wants", "offerSlug", "campaign", "utm", "website"]);

const ipLimit = mongoRateLimit({ name: "simple-request-ip", windowMs: HOUR, max: 10 });

function onlyKnownFields(req, res, next) {
  const b = req.body;
  if (!b || typeof b !== "object" || Array.isArray(b)) return res.status(400).json({ error: "VALIDATION", message: "Send the booking as JSON." });
  const unknown = Object.keys(b).filter((k) => !FIELDS.has(k));
  if (unknown.length) return res.status(400).json({ error: "VALIDATION", message: "Unexpected fields.", fields: unknown });
  return next();
}

const validators = [
  body("name")
    .isString()
    .trim()
    .isLength({ min: 2, max: 60 })
    .withMessage("Enter your name.")
    .matches(/^[\p{L}\p{M} .'-]+$/u)
    .withMessage("Enter your name using letters only."),
  body("phone")
    .customSanitizer((v) => Customer.normalisePhone(v))
    .custom((v) => v !== null)
    .withMessage("Enter a 10-digit mobile number."),
  body("date").custom(isValidDate).withMessage("Choose a day."),
  body("time").matches(wa.TIME_RE).withMessage("Choose a time."),
  // The one box: the service they want, in their own words, or anything else they want to tell us.
  body("wants").optional({ nullable: true }).isString().trim().isLength({ max: WANTS_MAX }).withMessage(`Keep it under ${WANTS_MAX} characters.`),
  body("offerSlug").optional({ nullable: true }).isString().matches(/^[a-z0-9-]{1,60}$/).withMessage("Unknown offer."),
  body("campaign").optional({ nullable: true }).isString().isLength({ max: 60 }),
  body("utm").optional({ nullable: true }).isObject(),
  body("utm.*").optional({ nullable: true }).isString().isLength({ max: 255 }),
  body("website").optional({ nullable: true }).isString().isLength({ max: 300 }),
];

async function createWithUniqueRef(doc) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await Appointment.create({ ...doc, ref: Appointment.generateRef() });
    } catch (err) {
      if (err?.code === 11000 && err?.keyPattern?.ref) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate a booking reference");
}

/** What the customer's page shows after sending: no price, no other customer's data. */
const summary = (appt, duplicate = false) => ({
  ref: appt.ref,
  status: appt.status,
  date: appt.requestedWindow?.date,
  time: appt.requestedWindow?.time,
  duplicate,
});

router.post("/requests/simple", onlyKnownFields, ipLimit, validators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: "VALIDATION", message: errors.array()[0].msg, fields: errors.array().map((e) => e.path) });
  }
  const b = req.body;

  // Honeypot: people cannot see this box. A bot that fills it is told "sent" and nothing is stored.
  if (typeof b.website === "string" && b.website.trim() !== "") {
    return res.status(201).json({ ref: Appointment.generateRef(), status: "requested", date: b.date, time: b.time, duplicate: false });
  }

  try {
    const settings = (await SiteSettings.getSingleton()).toObject();
    const today = salonDate();

    // An offer page sends its address. An offer that is not running is simply not recorded: the booking still counts.
    let offerDoc = null;
    if (b.offerSlug) {
      const found = await offerPages.findBySlug(b.offerSlug);
      if (found && offerPages.stateOn(found, today) === "live") offerDoc = found;
    }

    // ── The time: real, in the future, inside opening hours, with an hour's room for the service ──
    const problem = wa.slotProblem(settings, b.date, b.time, DEFAULT_DURATION_MINUTES);
    if (problem) return res.status(400).json({ error: "OUTSIDE_HOURS", message: problem, fields: ["time"] });

    // ── The same person asking for the same day and time again is one booking ──
    const repeat = await Appointment.findOne({
      contact: b.phone,
      status: { $in: ["requested", "confirmed"] },
      "source.channel": { $in: Appointment.WA_REQUEST_CHANNELS },
      "requestedWindow.date": b.date,
      "requestedWindow.time": b.time,
    });
    if (repeat) return res.status(200).json(summary(repeat, true));

    // ── Limits that count only real new bookings ──
    const phoneHit = await hit({ name: "simple-request-phone", id: b.phone, windowMs: 24 * HOUR, max: 3 });
    if (!phoneHit.allowed) {
      return res.status(429).json({ error: "LIMIT_REACHED", message: "You've sent a few bookings today. We'll be in touch on WhatsApp." });
    }
    const active = await Appointment.countDocuments({
      contact: b.phone,
      status: { $in: ["pending_payment", "requested", "confirmed"] },
      $or: [{ startAt: { $gte: new Date() } }, { startAt: null, "requestedWindow.date": { $gte: today } }],
    });
    if (active >= settings.maxActiveBookingsPerPhone) {
      return res.status(409).json({ error: "LIMIT_REACHED", message: "You already have bookings with us. We'll sort them out on WhatsApp." });
    }

    // ── Save ──
    const now = new Date();
    const campaign = wa.cleanCampaign(b.campaign) || (offerDoc ? offerDoc.page.slug : null);
    const utm = { ...(campaign ? { campaign } : {}), ...(cleanUtm(b.utm) || {}) };
    const customer = await Customer.findOneAndUpdate(
      { phone: b.phone },
      { $set: { name: b.name }, $setOnInsert: { createdFrom: "web", firstTouch: { utm, at: now } } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, runValidators: true }
    );
    const wants = typeof b.wants === "string" && b.wants.trim() ? b.wants.trim() : null;
    // The link in the customer's WhatsApp (/booking/<token>) is found by this saved key, as for every other booking.
    const _id = new mongoose.Types.ObjectId();
    const appt = await createWithUniqueRef({
      _id,
      manageTokenHash: hashManageToken(manageToken(_id)),
      mode: "request",
      status: "requested",
      customerId: customer._id,
      contact: b.phone,
      name: b.name,
      // No services from the list: the customer said what they want in their own words (notes). Reception sets it up.
      guests: [{ guestKey: "g1", name: b.name, gender: null, customerId: customer._id, items: [] }],
      requestedWindow: { date: b.date, window: wa.windowFor(settings, b.time), time: b.time },
      notes: wants,
      // Unpaid and unpriced: the price is given at the salon. An offer is applied by hand at billing.
      pricing: { subtotal: 0, discount: 0, total: 0, packageId: null },
      deposit: { required: false, amount: 0, status: "none" },
      source: {
        channel: "simple",
        utm: Object.keys(utm).length ? utm : null,
        campaign,
        offerSlug: offerDoc ? offerDoc.page.slug : null,
        offerHeadline: offerDoc ? offerDoc.page.headline || offerDoc.content?.headline || null : null,
        offerPrice: offerDoc ? offerDoc.page.price ?? null : null,
        offerPriceNote: offerDoc ? offerDoc.page.priceNote ?? null : null,
        promoCode: null,
        pixel: metaCapi.fromRequest(req),
      },
      policyVersion: settings.policyVersion,
      statusHistory: [{ from: null, to: "requested", at: now, by: "customer" }],
    });

    // Before responding: on Vercel, work after the response may never run. None of these throws.
    await Promise.all([wa.sendReceived(appt), alertNewRequest(appt), metaCapi.send("Lead", appt, { ip: clientIp(req) })]);

    return res.status(201).json(summary(appt));
  } catch (err) {
    console.error("[public] simple booking error:", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Something went wrong. Try again, or message us on WhatsApp." });
  }
});

module.exports = router;
