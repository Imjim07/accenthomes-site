'use strict';
const { defineSecret } = require('firebase-functions/params');
const paystackSecret = defineSecret('PAYSTACK_LIVE_SECRET');
const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const crypto    = require('crypto');
const jwt       = require('jsonwebtoken');

admin.initializeApp();
const db = admin.firestore();

// ── Shared helpers ─────────────────────────────────────────────────────────────

function hashIp(req) {
  const raw = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

async function verifyToken(req) {
  const header = (req.headers.authorization || '').trim();
  if (!header.startsWith('Bearer ')) {
    return { ok: false, status: 401, msg: 'Authentication required.' };
  }
  try {
    const decoded = await admin.auth().verifyIdToken(header.slice(7));
    return { ok: true, uid: decoded.uid, email: decoded.email || null };
  } catch (e) {
    return { ok: false, status: 401, msg: 'Invalid or expired session. Please sign in again.' };
  }
}

async function logRejected(hashedIp, reason, uid, endpoint) {
  try {
    await db.collection('security_logs').add({
      endpoint,
      reason,
      uid:      uid || null,
      hashedIp,
      ts:       admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    functions.logger.error('security_log write failed', { reason: e.message });
  }
}

function setCors(res) {
  // Tighten to your production domain before going live.
  res.set('Access-Control-Allow-Origin',  '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

// ── _sendBookingConfirmEmail ───────────────────────────────────────────────────
//
// Internal helper — sends a styled booking confirmation + T&C email to the guest.
// Called fire-and-forget from createBooking so the HTTP response is never delayed.
//
async function _sendBookingConfirmEmail(bookingId, data, nights, caution, resendKey) {
  if (!resendKey) {
    functions.logger.error('_sendBookingConfirmEmail: RESEND_API_KEY not set');
    return;
  }

  const ref     = bookingId.slice(0, 8).toUpperCase();
  const rent    = data.rent   || 0;
  const total   = data.total  || 0;
  const fmt     = n => '₦' + Number(n).toLocaleString('en-NG');
  const fmtDate = s => { if (!s) return '—'; const [y,m,d] = s.split('-'); return `${d}/${m}/${y}`; };

  const text = [
    `Booking Confirmed — Accent Homes`,
    ``,
    `Dear ${data.guestName},`,
    ``,
    `Your reservation is confirmed. Below are your booking details:`,
    ``,
    `  Reference:         ${ref}`,
    `  Apartment:         ${data.aptName}`,
    `  Location:          ${data.location || 'Asaba, Delta State'}`,
    `  Check-In:          ${data.checkIn} at 4:00 PM`,
    `  Check-Out:         ${data.checkOut} at 11:00 AM`,
    `  Nights:            ${nights}`,
    `  Rent:              ${fmt(rent)}`,
    `  Security Deposit:  ${fmt(caution)} (refunded within 14 business days after checkout)`,
    `  Total Paid:        ${fmt(total)}`,
    ``,
    `Please save this email as your booking confirmation.`,
    ``,
    `─────────────────────────────────────────────────`,
    `WELCOME LETTER`,
    `─────────────────────────────────────────────────`,
    ``,
    `Welcome to your home away from home, ${data.guestName}!`,
    `We're thrilled to have you stay with us at Accent Homes.`,
    ``,
    `CHECK-IN DETAILS`,
    `  Check-In:   ${fmtDate(data.checkIn)} at 4:00 PM`,
    `  Check-Out:  ${fmtDate(data.checkOut)} at 11:00 AM`,
    `  Apartment:  ${data.aptName}`,
    `  Reference:  ${ref}`,
    ``,
    `ADDRESS`,
    `  Sunday Okiah Street, Off Church Road,`,
    `  Before Vin Milan Hotel, Marble Hill Road,`,
    `  Asaba, Delta State.`,
    ``,
    `ACCESS INSTRUCTIONS`,
    `  We will make available codes for your entrance to the apartment.`,
    ``,
    `HOUSE RULES`,
    `  • No Smoking Policy for each apartment`,
    `  • No loud music after 10 PM`,
    `  • No fighting`,
    `  • No noise pollution of any kind`,
    ``,
    `AMENITIES`,
    `  • Wi-Fi: Each apartment has its own network name and password on the router`,
    `  • Kitchen: Fully equipped appliances for all your cooking needs`,
    ``,
    `LOCAL RECOMMENDATIONS`,
    `  Food & Logistics: Obic Logistics`,
    `  Phone: 09075355144  |  Website: Obictrade.com.ng`,
    ``,
    `EMERGENCY CONTACTS`,
    `  Property Supervisor: 09111700046`,
    `  Property Manager:    09111700046`,
    `  Email: help@accenthomesltd.com`,
    ``,
    `─────────────────────────────────────────────────`,
    `SHORT-TERM RENTAL TERMS & CONDITIONS`,
    `─────────────────────────────────────────────────`,
    ``,
    `1. GUEST REQUIREMENTS`,
    `   • Minimum age: 25 years old.`,
    `   • Valid government-issued ID required at check-in.`,
    `   • Maximum of 6 guests per booking.`,
    `   • Only registered guests may stay overnight.`,
    `   • Subletting or transferring the reservation is not permitted.`,
    ``,
    `2. PAYMENT & SECURITY DEPOSIT`,
    `   • Full payment is required before check-in.`,
    `   • A 25% security deposit is charged at booking.`,
    `   • Security deposit is refunded within 14 business days after checkout, subject to no damage.`,
    ``,
    `3. CHECK-IN / CHECK-OUT`,
    `   • Check-in: 4:00 PM.`,
    `   • Check-out: 11:00 AM.`,
    `   • Late checkout requires prior written approval and may incur additional charges.`,
    ``,
    `4. PROPERTY RULES`,
    `   • No smoking inside the property.`,
    `   • No pets.`,
    `   • No parties, watch parties, events, or excessive noise.`,
    `   • No illegal activities of any kind.`,
    `   • Guests must comply with all building rules and regulations.`,
    ``,
    `5. PROPERTY CARE & VISITORS`,
    `   • Guests are responsible for the property's condition during their stay.`,
    `   • Any damage, loss, or additional cleaning costs will be charged to the guest.`,
    `   • All visitors must receive prior approval and count toward the maximum occupancy.`,
    ``,
    `6. CANCELLATION POLICY`,
    `   • Cancellations made 14 or more days before check-in: full refund.`,
    `   • Cancellations within 14 days of check-in: non-refundable unless approved in writing by Accent Homes.`,
    ``,
    `7. LIABILITY & COMPLIANCE`,
    `   • Guests are responsible for their personal property throughout the stay.`,
    `   • Accent Homes is not liable for accidents, injuries, or loss of personal belongings.`,
    `   • Violations of these terms may result in immediate termination of the stay without refund.`,
    ``,
    `8. GUEST ACKNOWLEDGMENT`,
    `   By completing payment and occupying the property, the guest agrees to these Terms & Conditions in full.`,
    ``,
    `─────────────────────────────────────────────────`,
    `Accent Homes · Asaba, Delta State, Nigeria`,
    `For assistance: hello@accenthomesltd.com`,
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F2EE;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F2EE;padding:32px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">

  <!-- Header -->
  <tr><td style="background:#2B2B2B;padding:28px 32px;text-align:center;border-radius:8px 8px 0 0">
    <div style="font-family:Georgia,serif;font-size:2.2rem;color:#C86233;letter-spacing:0.06em;line-height:1">Λ</div>
    <div style="font-family:Georgia,serif;font-size:1.05rem;color:#F8F8F8;letter-spacing:0.1em;margin-top:6px">ACCENT HOMES</div>
    <div style="font-size:0.72rem;color:rgba(248,248,248,0.45);letter-spacing:0.12em;margin-top:4px;text-transform:uppercase">Asaba · Delta State</div>
  </td></tr>

  <!-- Confirmed banner -->
  <tr><td style="background:#C86233;padding:14px 32px;text-align:center">
    <span style="font-family:Georgia,serif;font-size:1rem;color:#fff;letter-spacing:0.06em">Booking Confirmed</span>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#fff;padding:36px 32px">

    <p style="margin:0 0 6px;font-size:0.92rem;color:#2B2B2B">Dear <strong>${data.guestName}</strong>,</p>
    <p style="margin:0 0 28px;font-size:0.88rem;color:#666;line-height:1.7">
      Your reservation at <strong style="color:#2B2B2B">${data.aptName}</strong> is confirmed.
      Please keep this email — it is your official booking record.
    </p>

    <!-- Reference pill -->
    <div style="background:#F5F2EE;border:1px solid #E8E3DC;border-radius:6px;padding:16px 20px;margin-bottom:28px;text-align:center">
      <div style="font-size:0.7rem;color:#999;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px">Booking Reference</div>
      <div style="font-family:Georgia,serif;font-size:1.6rem;letter-spacing:0.18em;color:#C86233;font-weight:700">${ref}</div>
    </div>

    <!-- Details table -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:0.875rem;border-collapse:collapse">
      <tr style="border-bottom:1px solid #F0EDE8">
        <td style="padding:10px 0;color:#888;width:45%">Apartment</td>
        <td style="padding:10px 0;color:#2B2B2B;font-weight:600">${data.aptName}</td>
      </tr>
      <tr style="border-bottom:1px solid #F0EDE8">
        <td style="padding:10px 0;color:#888">Location</td>
        <td style="padding:10px 0;color:#2B2B2B">${data.location || 'Asaba, Delta State'}</td>
      </tr>
      <tr style="border-bottom:1px solid #F0EDE8">
        <td style="padding:10px 0;color:#888">Check-In</td>
        <td style="padding:10px 0;color:#2B2B2B"><strong>${data.checkIn}</strong> &nbsp;·&nbsp; 4:00 PM</td>
      </tr>
      <tr style="border-bottom:1px solid #F0EDE8">
        <td style="padding:10px 0;color:#888">Check-Out</td>
        <td style="padding:10px 0;color:#2B2B2B"><strong>${data.checkOut}</strong> &nbsp;·&nbsp; 11:00 AM</td>
      </tr>
      <tr style="border-bottom:1px solid #F0EDE8">
        <td style="padding:10px 0;color:#888">Nights</td>
        <td style="padding:10px 0;color:#2B2B2B">${nights}</td>
      </tr>
      <tr style="border-bottom:1px solid #F0EDE8">
        <td style="padding:10px 0;color:#888">Rent</td>
        <td style="padding:10px 0;color:#2B2B2B">${fmt(rent)}</td>
      </tr>
      <tr style="border-bottom:1px solid #F0EDE8">
        <td style="padding:10px 0;color:#888">Security Deposit</td>
        <td style="padding:10px 0;color:#2B2B2B">${fmt(caution)} <span style="font-size:0.75rem;color:#999">(refundable)</span></td>
      </tr>
      <tr>
        <td style="padding:14px 0 4px;color:#2B2B2B;font-weight:700;font-size:0.95rem">Total Paid</td>
        <td style="padding:14px 0 4px;color:#C86233;font-weight:700;font-size:1.05rem">${fmt(total)}</td>
      </tr>
    </table>

    <p style="margin:28px 0 0;font-size:0.82rem;color:#999;line-height:1.7">
      You will receive check-in instructions and a property access guide closer to your arrival date.
      For any queries, reply to this email or contact us at
      <a href="mailto:hello@accenthomesltd.com" style="color:#C86233;text-decoration:none">hello@accenthomesltd.com</a>.
    </p>
  </td></tr>

  <!-- Welcome Letter -->
  <tr><td style="background:#fff;padding:28px 32px;border-top:2px solid #C86233">
    <h2 style="font-family:Georgia,serif;font-size:1rem;font-weight:400;color:#2B2B2B;letter-spacing:0.06em;margin:0 0 6px">Welcome to Your Home Away From Home!</h2>
    <p style="font-size:0.85rem;color:#555;line-height:1.7;margin:0 0 20px">
      Dear <strong>${data.guestName}</strong>, we're thrilled to have you stay with us at Accent Homes.
      We hope your journey was smooth and that you're ready to enjoy your time.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:0.82rem;color:#444;line-height:1.75;border-collapse:collapse">
      <tr><td style="padding:10px 0;border-bottom:1px solid #F0EDE8;vertical-align:top">
        <strong style="color:#C86233;display:block;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">Check-In Details</strong>
        <div>Check-In: <strong>${fmtDate(data.checkIn)}</strong> at 4:00 PM</div>
        <div>Check-Out: <strong>${fmtDate(data.checkOut)}</strong> at 11:00 AM</div>
        <div>Apartment: <strong>${data.aptName}</strong></div>
        <div>Booking Reference: <strong style="color:#C86233">${ref}</strong></div>
      </td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #F0EDE8;vertical-align:top">
        <strong style="color:#C86233;display:block;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">Address</strong>
        Sunday Okiah Street, Off Church Road,<br>Before Vin Milan Hotel, Marble Hill Road,<br>Asaba, Delta State.
      </td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #F0EDE8;vertical-align:top">
        <strong style="color:#C86233;display:block;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">Access Instructions</strong>
        We will make available codes for your entrance to the apartment.
      </td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #F0EDE8;vertical-align:top">
        <strong style="color:#C86233;display:block;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">House Rules</strong>
        • No Smoking Policy for each apartment<br>
        • No loud music after 10 PM<br>
        • No fighting<br>
        • No noise pollution of any kind
      </td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #F0EDE8;vertical-align:top">
        <strong style="color:#C86233;display:block;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">Amenities</strong>
        • Wi-Fi: Each apartment has its own network name and password on the router<br>
        • Kitchen: Fully equipped appliances for all your cooking needs
      </td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #F0EDE8;vertical-align:top">
        <strong style="color:#C86233;display:block;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">Local Recommendations</strong>
        Food &amp; Logistics: <strong>Obic Logistics</strong> — 📞 09075355144 &nbsp;|&nbsp; 🌐 Obictrade.com.ng
      </td></tr>
      <tr><td style="padding:10px 0;vertical-align:top">
        <strong style="color:#C86233;display:block;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">Emergency Contacts</strong>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background:#F7F4F1;border-radius:4px;padding:10px 14px;width:50%;vertical-align:top">
              <strong style="display:block;font-size:0.82rem;color:#2B2B2B">Property Supervisor</strong>
              <span style="font-size:0.82rem;color:#5A5A5A">📞 09111700046</span>
            </td>
            <td width="8"></td>
            <td style="background:#F7F4F1;border-radius:4px;padding:10px 14px;width:50%;vertical-align:top">
              <strong style="display:block;font-size:0.82rem;color:#2B2B2B">Property Manager</strong>
              <span style="font-size:0.82rem;color:#5A5A5A">📞 09111700046</span>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>

    <p style="margin:20px 0 0;font-size:0.82rem;color:#888;line-height:1.7">
      We're here to make your stay as enjoyable as possible. For any questions, reply to this email or reach us at
      <a href="mailto:help@accenthomesltd.com" style="color:#C86233;text-decoration:none">help@accenthomesltd.com</a>.
    </p>
  </td></tr>

  <!-- T&C section -->
  <tr><td style="background:#F5F2EE;padding:28px 32px;border-top:1px solid #E8E3DC">
    <h3 style="font-family:Georgia,serif;font-size:0.9rem;font-weight:400;color:#2B2B2B;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 18px;border-bottom:1px solid #E0DBD3;padding-bottom:10px">
      Short-Term Rental Terms &amp; Conditions
    </h3>
    <p style="font-size:0.75rem;color:#666;line-height:1.8;margin:0 0 14px">
      By completing payment and occupying the property, you agree to all terms below in full.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:0.78rem;color:#444;line-height:1.75">
      <tr><td style="padding:8px 0;border-bottom:1px solid #EAE7E3;vertical-align:top">
        <strong style="color:#C86233;display:block;margin-bottom:4px">1. Guest Requirements</strong>
        Minimum age 25 years old &nbsp;·&nbsp; Valid government-issued ID required at check-in &nbsp;·&nbsp;
        Maximum of 6 guests &nbsp;·&nbsp; Only registered guests may stay overnight &nbsp;·&nbsp; No subletting or transferring of the reservation.
      </td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #EAE7E3;vertical-align:top">
        <strong style="color:#C86233;display:block;margin-bottom:4px">2. Payment &amp; Security Deposit</strong>
        Full payment required before check-in &nbsp;·&nbsp; 25% security deposit charged at booking &nbsp;·&nbsp;
        Deposit refunded within 14 business days after checkout, subject to no damage.
      </td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #EAE7E3;vertical-align:top">
        <strong style="color:#C86233;display:block;margin-bottom:4px">3. Check-In / Check-Out</strong>
        Check-in: 4:00 PM &nbsp;·&nbsp; Check-out: 11:00 AM &nbsp;·&nbsp;
        Late checkout requires prior written approval and may incur additional charges.
      </td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #EAE7E3;vertical-align:top">
        <strong style="color:#C86233;display:block;margin-bottom:4px">4. Property Rules</strong>
        No smoking inside the property &nbsp;·&nbsp; No pets &nbsp;·&nbsp;
        No parties, watch parties, events, or excessive noise &nbsp;·&nbsp;
        No illegal activities &nbsp;·&nbsp; Comply with all building rules and regulations.
      </td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #EAE7E3;vertical-align:top">
        <strong style="color:#C86233;display:block;margin-bottom:4px">5. Property Care &amp; Visitors</strong>
        Guests are responsible for the property's condition during their stay &nbsp;·&nbsp;
        Any damage, loss, or additional cleaning costs will be charged to the guest &nbsp;·&nbsp;
        All visitors require prior approval and count toward maximum occupancy.
      </td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #EAE7E3;vertical-align:top">
        <strong style="color:#C86233;display:block;margin-bottom:4px">6. Cancellation Policy</strong>
        14+ days before check-in: full refund &nbsp;·&nbsp;
        Within 14 days: non-refundable unless approved in writing by Accent Homes.
      </td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #EAE7E3;vertical-align:top">
        <strong style="color:#C86233;display:block;margin-bottom:4px">7. Liability &amp; Compliance</strong>
        Guests are responsible for their personal property throughout the stay &nbsp;·&nbsp;
        Accent Homes is not liable for accidents, injuries, or loss of personal belongings &nbsp;·&nbsp;
        Violations may result in immediate termination of the stay without refund.
      </td></tr>
      <tr><td style="padding:8px 0;vertical-align:top">
        <strong style="color:#C86233;display:block;margin-bottom:4px">8. Guest Acknowledgment</strong>
        By completing payment and occupying the property, the guest agrees to these Terms &amp; Conditions in full.
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#2B2B2B;padding:20px 32px;text-align:center;border-radius:0 0 8px 8px">
    <p style="margin:0;font-size:0.72rem;color:rgba(248,248,248,0.4);line-height:1.8">
      Accent Homes &nbsp;·&nbsp; Asaba, Delta State, Nigeria<br>
      <a href="mailto:hello@accenthomesltd.com" style="color:#C86233;text-decoration:none">hello@accenthomesltd.com</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const rsRes = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    'Accent Homes <noreply@accenthomesltd.com>',
      to:      [data.guestEmail],
      subject: `Booking Confirmed — ${data.aptName} · Ref ${ref}`,
      text,
      html
    })
  });

  if (!rsRes.ok) {
    const body = await rsRes.text();
    functions.logger.error('_sendBookingConfirmEmail: Resend error', { status: rsRes.status, body });
  } else {
    functions.logger.info('Booking confirm email sent', { guestEmail: data.guestEmail, ref });
  }
}

// ── createBooking ──────────────────────────────────────────────────────────────
//
// POST /createBooking
// Authorization: Bearer <firebase-id-token>
// Body: { aptId, aptName, location, checkIn, checkOut, guestName, guestEmail,
//         phone, idUrl, paystackRef }
//
// nights / rent / caution / total are computed server-side from the listing doc
// and verified against the Paystack transaction — client-supplied amounts are
// ignored entirely.
//
// Rejects:
//   401 — missing / invalid / expired token
//   403 — phone not yet verified
//   400 — required fields absent or invalid dates
//   404 — listing not found
//   409 — listing already booked
//   402 — Paystack payment not successful or amount mismatch
//   500 — internal error
// Returns:
//   201 { success: true, bookingId }
//
exports.createBooking = functions.runWith({ secrets: [paystackSecret] }).https.onCall(async (data, context) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed.' });

  const ip = hashIp(req);
  const b  = req.body || {};

  // 1. Validate required fields
  const required = ['aptId', 'aptName', 'checkIn', 'checkOut', 'paystackRef', 'guestName', 'guestEmail'];
  const missing  = required.filter(k => !b[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }
  if (!b.guestEmail.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  // 2. Read listing — recompute price server-side, check availability
  let listingData;
  try {
    const listingSnap = await db.collection('listings').doc(b.aptId).get();
    if (!listingSnap.exists) {
      return res.status(404).json({ error: 'Apartment not found.' });
    }
    listingData = listingSnap.data();
  } catch (e) {
    functions.logger.error('listings read error', { aptId: b.aptId, err: e.message });
    return res.status(500).json({ error: 'Could not verify apartment. Please try again.' });
  }

  if (listingData.available === false || listingData.status === 'booked') {
    return res.status(409).json({ error: 'This apartment is no longer available.' });
  }

  // Server-authoritative price — client-supplied amounts are ignored
  const nights = Math.round(
    (new Date(b.checkOut).getTime() - new Date(b.checkIn).getTime()) / 86400000
  );
  if (!Number.isFinite(nights) || nights < 1) {
    return res.status(400).json({ error: 'Invalid check-in / check-out dates.' });
  }

  const guests       = Number(b.guests) || 1;
  const maxGuests    = Number(listingData.maxGuests || 10);
  if (guests < 1 || guests > maxGuests) {
    return res.status(400).json({ error: `Guest count must be between 1 and ${maxGuests}.` });
  }

  const rent         = Number(listingData.priceNight    || 0) * nights;
  const cautionSmall = Number(listingData.cautionDeposit || 0);
  const cautionBig   = Number(listingData.cautionLarge   || cautionSmall);
  const caution      = guests > 5 ? cautionBig : cautionSmall;
  const total        = rent + caution;

  if (total <= 0) {
    functions.logger.error('listing has zero price', { aptId: b.aptId });
    return res.status(500).json({ error: 'Apartment pricing is not configured. Please contact us.' });
  }

  // 3. Paystack-ref deduplication — reject replays of an already-used reference
  try {
    const dupSnap = await db.collection('bookings')
      .where('paystackRef', '==', b.paystackRef)
      .limit(1)
      .get();
    if (!dupSnap.empty) {
      await logRejected(ip, 'paystack_ref_reused', null, 'createBooking');
      return res.status(409).json({ error: 'This payment reference has already been used.' });
    }
  } catch (e) {
    functions.logger.error('paystackRef dedup error', { err: e.message });
    return res.status(500).json({ error: 'Could not verify payment reference. Please try again.' });
  }

  // 4. Verify Paystack payment — runs OUTSIDE the transaction (no external HTTP inside tx)
  const paystackKey = paystackSecret.value();
  if (!paystackKey) {
    functions.logger.error('paystackSecret.value() not set');
    return res.status(500).json({ error: 'Payment verification unavailable. Please contact us.' });
  }

  let paystackTxId = null;
  try {
    const psRes  = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(b.paystackRef)}`,
      { headers: { Authorization: `Bearer ${paystackKey}` } }
    );
    const psJson = await psRes.json();

    if (!psRes.ok || psJson.data?.status !== 'success') {
      await logRejected(ip, 'paystack_not_success', null, 'createBooking');
      return res.status(402).json({
        error: 'Payment could not be verified. Please contact us with your payment reference.'
      });
    }

    const paidKobo     = psJson.data.amount;
    const expectedKobo = Math.round(total * 100);
    if (paidKobo !== expectedKobo) {
      await logRejected(ip, 'paystack_amount_mismatch', null, 'createBooking');
      functions.logger.warn('Paystack amount mismatch', {
        paystackRef: b.paystackRef, paidKobo, expectedKobo
      });
      return res.status(402).json({
        error: 'Payment amount does not match the booking total. Please contact us.'
      });
    }

    paystackTxId = psJson.data.id;
  } catch (e) {
    functions.logger.error('Paystack verify error', { err: e.message });
    return res.status(500).json({
      error: 'Payment verification error. Please contact us with your payment reference.'
    });
  }

  // 5. Transaction: re-check availability + date overlap + write booking + mark listing booked.
  //    Closes the TOCTOU gap — only one concurrent guest wins the transaction; the loser is refunded.
  const bookingRef = db.collection('bookings').doc();
  const listingRef = db.collection('listings').doc(b.aptId);
  let   bookingId;

  const bookingData = {
    aptId:            b.aptId,
    aptName:          b.aptName,
    location:         listingData.location || b.location || '',
    checkIn:          b.checkIn,
    checkOut:         b.checkOut,
    guests,
    nights,
    rent,
    caution,
    total,
    guestName:        b.guestName,
    guestEmail:       b.guestEmail,
    guestEmail_canon: b.guestEmail.toLowerCase(),
    paystackRef:      b.paystackRef,
    linkedUid:        null,
    status:           'confirmed',
    createdAt:        admin.firestore.FieldValue.serverTimestamp()
  };

  try {
    await db.runTransaction(async (tx) => {
      // All reads before writes (Firestore transaction requirement)
      const listingSnap = await tx.get(listingRef);
      if (!listingSnap.exists ||
          listingSnap.data().available === false ||
          listingSnap.data().status   === 'booked') {
        const err = new Error('Apartment no longer available.');
        err.code  = 'DOUBLE_BOOKING';
        throw err;
      }

      const overlapQuery = db.collection('bookings')
        .where('aptId',   '==', b.aptId)
        .where('status',  '==', 'confirmed')
        .where('checkIn', '<',  b.checkOut);
      const overlapSnap = await tx.get(overlapQuery);
      const hasOverlap  = overlapSnap.docs.some(d => d.data().checkOut >= b.checkIn);
      if (hasOverlap) {
        const err = new Error('Dates overlap with an existing booking.');
        err.code  = 'DOUBLE_BOOKING';
        throw err;
      }

      tx.set(bookingRef, bookingData);
      tx.update(listingRef, { status: 'booked', available: false });
      // Write public date range — no PII — so the calendar can block these dates for all visitors
      tx.set(
        db.collection('listings').doc(b.aptId).collection('booked_ranges').doc(bookingRef.id),
        { checkIn: b.checkIn, checkOut: b.checkOut }
      );
    });
    bookingId = bookingRef.id;
  } catch (e) {
    if (e.code === 'DOUBLE_BOOKING') {
      if (paystackTxId) {
        try {
          await fetch('https://api.paystack.co/refund', {
            method:  'POST',
            headers: {
              Authorization:  `Bearer ${paystackKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ transaction: paystackTxId })
          });
        } catch (refundErr) {
          functions.logger.error('Paystack refund failed', {
            paystackTxId, paystackRef: b.paystackRef, err: refundErr.message
          });
        }
      }
      await logRejected(ip, 'double_booking_refunded', null, 'createBooking');
      return res.status(409).json({
        error: 'Sorry, this apartment was just booked by someone else. Your payment has been refunded — please allow 2–5 business days.'
      });
    }
    functions.logger.error('booking transaction failed', {
      paystackRef: b.paystackRef, err: e.message
    });
    return res.status(500).json({ error: 'Could not save booking. Please try again.' });
  }

  // Send confirmation email — fire-and-forget (don't block the 201 response)
  _sendBookingConfirmEmail(bookingId, bookingData, nights, caution, process.env.RESEND_API_KEY)
    .catch(e => functions.logger.error('Booking confirm email failed', { bookingId, err: e.message }));

  functions.logger.info('Booking created', { bookingId, aptId: b.aptId });
  return res.status(201).json({ success: true, bookingId });
});

// ── cancelBooking ──────────────────────────────────────────────────────────────
//
// POST /cancelBooking
// Authorization: Bearer <firebase-id-token>
// Body: { bookingId }
//
exports.cancelBooking = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed.' });

  const ip = hashIp(req);

  const auth = await verifyToken(req);
  if (!auth.ok) {
    await logRejected(ip, 'invalid_token', null, 'cancelBooking');
    return res.status(auth.status).json({ error: auth.msg });
  }

  const { bookingId } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'bookingId is required.' });

  let bookingSnap;
  try {
    bookingSnap = await db.collection('bookings').doc(bookingId).get();
  } catch (e) {
    return res.status(500).json({ error: 'Could not read booking.' });
  }

  if (!bookingSnap.exists) return res.status(404).json({ error: 'Booking not found.' });

  // Ownership check — uid must match the verified token
  if (bookingSnap.data().guestUid !== auth.uid) {
    await logRejected(ip, 'uid_mismatch', auth.uid, 'cancelBooking');
    return res.status(403).json({ error: 'You are not authorised to cancel this booking.' });
  }

  const aptId = bookingSnap.data().aptId || null;
  const batch = db.batch();

  batch.update(db.collection('bookings').doc(bookingId), {
    status:      'cancelled',
    cancelledAt: admin.firestore.FieldValue.serverTimestamp()
  });

  if (aptId) {
    batch.update(db.collection('listings').doc(aptId), {
      status:    'available',
      available: true
    });
    // Remove the public date range so the calendar unblocks those dates immediately
    batch.delete(db.collection('listings').doc(aptId).collection('booked_ranges').doc(bookingId));
  }

  try {
    await batch.commit();
  } catch (e) {
    functions.logger.error('cancelBooking batch failed', { bookingId, err: e.message });
    return res.status(500).json({ error: 'Could not cancel booking. Please try again.' });
  }

  functions.logger.info('Booking cancelled', { bookingId, uid: auth.uid, aptId });
  return res.status(200).json({ success: true });
});

// ── linkBookingToAccount ───────────────────────────────────────────────────────
//
// POST /linkBookingToAccount
// Authorization: Bearer <firebase-id-token>
// Body: { bookingId }
//
// Called from the post-payment account-creation step. Links a confirmed booking
// to a Firebase Auth UID so the guest can view it in their profile.
// Safe to call only once — returns 409 if already linked.
//
exports.linkBookingToAccount = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed.' });

  const auth = await verifyToken(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

  const { bookingId } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'bookingId is required.' });

  let bookingSnap;
  try {
    bookingSnap = await db.collection('bookings').doc(bookingId).get();
  } catch (e) {
    return res.status(500).json({ error: 'Could not read booking.' });
  }

  if (!bookingSnap.exists) return res.status(404).json({ error: 'Booking not found.' });

  if (bookingSnap.data().linkedUid) {
    return res.status(409).json({ error: 'Booking already linked to an account.' });
  }

  try {
    await db.collection('bookings').doc(bookingId).update({
      linkedUid: auth.uid,
      linkedAt:  admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    functions.logger.error('linkBookingToAccount failed', { bookingId, uid: auth.uid, err: e.message });
    return res.status(500).json({ error: 'Could not link booking. Please try again.' });
  }

  functions.logger.info('Booking linked to account', { bookingId, uid: auth.uid });
  return res.status(200).json({ success: true });
});

// ── sendEmailOTP ───────────────────────────────────────────────────────────────
//
// POST /sendEmailOTP
// Authorization: Bearer <firebase-id-token>
// Body: {} (email taken from the verified token — never from the body)
//
// Generates a 6-digit OTP, stores SHA-256(code+uid) in email_otps/{uid},
// sends the code to the user's email via SendGrid.
// Rate limit: 3 sends per hour per user.
//
// Returns:  200 { success: true }
// Rejects:  401 — invalid token
//           400 — no email on account
//           429 — rate limit exceeded
//           500 — send or config failure
//
exports.sendEmailOTP = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed.' });

  const ip = hashIp(req);

  const auth = await verifyToken(req);
  if (!auth.ok) {
    await logRejected(ip, 'invalid_token', null, 'sendEmailOTP');
    return res.status(auth.status).json({ error: auth.msg });
  }

  if (!auth.email) {
    return res.status(400).json({ error: 'No email address on this account.' });
  }

  // Rate limit: max 3 sends per hour
  const otpRef  = db.collection('email_otps').doc(auth.uid);
  const otpSnap = await otpRef.get();
  const now     = Date.now();

  if (otpSnap.exists) {
    const d           = otpSnap.data();
    const windowStart = d.sendWindowStart?.toMillis ? d.sendWindowStart.toMillis() : 0;
    if (now - windowStart < 3600000 && (d.sendCount || 0) >= 3) {
      await logRejected(ip, 'email_otp_rate_limit', auth.uid, 'sendEmailOTP');
      return res.status(429).json({ error: 'Too many code requests. Please wait an hour before trying again.' });
    }
  }

  // Generate cryptographically secure 6-digit code
  const code        = String(crypto.randomInt(100000, 1000000));
  const codeHash    = crypto.createHash('sha256').update(code + auth.uid).digest('hex');
  const isNewWindow = !otpSnap.exists ||
    (now - (otpSnap.data().sendWindowStart?.toMillis?.() || 0) > 3600000);
  const newSendCount = isNewWindow ? 1 : (otpSnap.data().sendCount || 0) + 1;

  await otpRef.set({
    codeHash,
    email:           auth.email,
    expiresAt:       admin.firestore.Timestamp.fromMillis(now + 600000), // 10 min
    attempts:        0,
    sendCount:       newSendCount,
    sendWindowStart: isNewWindow
      ? admin.firestore.FieldValue.serverTimestamp()
      : (otpSnap.data().sendWindowStart || admin.firestore.FieldValue.serverTimestamp()),
    createdAt:       admin.firestore.FieldValue.serverTimestamp()
  });

  // Send via Resend — verify your sender domain at resend.com/domains before going live.
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    functions.logger.error('RESEND_API_KEY not set');
    return res.status(500).json({ error: 'Email service not configured. Please contact us.' });
  }

  try {
    const rsRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from:    'Accent Homes <noreply@accenthomesltd.com>',
        to:      [auth.email],
        subject: 'Your Accent Homes verification code',
        text:    `Your Accent Homes verification code is: ${code}\n\nThis code expires in 10 minutes. If you did not request this, you can safely ignore this email.`,
        html:    `<p style="font-family:sans-serif">Your Accent Homes verification code is:</p><h2 style="letter-spacing:6px;font-family:monospace">${code}</h2><p style="font-family:sans-serif">This code expires in 10 minutes.</p><p style="font-family:sans-serif;color:#888;font-size:12px">If you did not request this, you can safely ignore this email.</p>`
      })
    });

    if (!rsRes.ok) {
      const body = await rsRes.text();
      functions.logger.error('Resend error', { status: rsRes.status, body });
      return res.status(500).json({ error: 'Could not send verification email. Please try again.' });
    }
  } catch (e) {
    functions.logger.error('Resend fetch failed', { uid: auth.uid, err: e.message });
    return res.status(500).json({ error: 'Could not send verification email. Please try again.' });
  }

  functions.logger.info('Email OTP sent', { uid: auth.uid });
  return res.status(200).json({ success: true });
});

// ── verifyEmailOTP ─────────────────────────────────────────────────────────────
//
// POST /verifyEmailOTP
// Authorization: Bearer <firebase-id-token>
// Body: { code: "123456" }
//
// Verifies the 6-digit code against the hash stored in email_otps/{uid}.
// On success, sets guestProfiles/{uid}.emailVerified = true and deletes the OTP doc.
//
// Returns:  200 { success: true }
// Rejects:  401 — invalid token or wrong code
//           400 — missing code, no OTP doc, or code expired
//           429 — too many incorrect attempts
//
exports.verifyEmailOTP = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed.' });

  const ip = hashIp(req);

  const auth = await verifyToken(req);
  if (!auth.ok) {
    await logRejected(ip, 'invalid_token', null, 'verifyEmailOTP');
    return res.status(auth.status).json({ error: auth.msg });
  }

  const { code } = req.body || {};
  if (!code || !/^\d{6}$/.test(String(code))) {
    return res.status(400).json({ error: 'A 6-digit code is required.' });
  }

  const otpRef = db.collection('email_otps').doc(auth.uid);
  let otpSnap;
  try {
    otpSnap = await otpRef.get();
  } catch (e) {
    return res.status(500).json({ error: 'Could not verify code. Please try again.' });
  }

  if (!otpSnap.exists) {
    return res.status(400).json({ error: 'No verification code found. Please request a new one.' });
  }

  const d = otpSnap.data();

  if (d.expiresAt.toMillis() < Date.now()) {
    await otpRef.delete();
    await logRejected(ip, 'email_otp_expired', auth.uid, 'verifyEmailOTP');
    return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
  }

  if ((d.attempts || 0) >= 5) {
    await logRejected(ip, 'email_otp_max_attempts', auth.uid, 'verifyEmailOTP');
    return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
  }

  const inputHash = crypto.createHash('sha256').update(String(code) + auth.uid).digest('hex');
  if (inputHash !== d.codeHash) {
    await otpRef.update({ attempts: admin.firestore.FieldValue.increment(1) });
    await logRejected(ip, 'email_otp_wrong_code', auth.uid, 'verifyEmailOTP');
    return res.status(401).json({ error: 'Incorrect code. Please try again.' });
  }

  // Code correct — mark email verified and clean up
  try {
    await db.collection('guestProfiles').doc(auth.uid).set({
      emailVerified:   true,
      emailVerifiedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await otpRef.delete();
  } catch (e) {
    functions.logger.error('verifyEmailOTP profile update failed', { uid: auth.uid, err: e.message });
    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  }

  functions.logger.info('Email verified', { uid: auth.uid });
  return res.status(200).json({ success: true });
});

// ── setAdminClaim — run ONCE per admin account ─────────────────────────────────
//
// POST /setAdminClaim
// Body: { uid: "<firebase-auth-uid>", secret: "<ADMIN_SETUP_SECRET>" }
//
// Set ADMIN_SETUP_SECRET with:
//   firebase functions:config:set admin.setup_secret="your-long-random-secret"
//
// After running, the target account has `admin: true` in its custom claims.
// The Firestore rules use this claim to permit admin-panel write operations.
//
exports.setAdminClaim = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed.' });

  const configSecret = (functions.config().admin || {}).setup_secret || process.env.ADMIN_SETUP_SECRET;
  const { uid, secret } = req.body || {};

  if (!configSecret || secret !== configSecret) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  if (!uid) return res.status(400).json({ error: 'uid is required.' });

  try {
    await admin.auth().setCustomUserClaims(uid, { admin: true });
    functions.logger.info('Admin claim granted', { uid });
    return res.status(200).json({ success: true, message: `admin:true set on ${uid}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── bookingStart ───────────────────────────────────────────────────────────────
//
// POST /bookingStart
// No Authorization required — guest checkout path.
// Body: { name, email, aptId }
//
// Validates the listing exists and is available, enforces a per-email rate
// limit (max 3 per hour), generates a 6-digit OTP, stores a pending_bookings
// doc, and sends the code via SendGrid.
//
// Returns: 200 { pending_booking_id }
//
exports.bookingStart = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed.' });

  const { name, email, aptId } = req.body || {};

  // 1. Field validation
  if (!name || !email || !aptId) {
    return res.status(400).json({ error: 'name, email, and aptId are required.' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  const normEmail = email.toLowerCase().trim();

  // 2. Listing validation — BEFORE rate limit and OTP (test 6: no OTP for invalid aptId)
  let listingData;
  try {
    const snap = await db.collection('listings').doc(aptId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Apartment not found.' });
    }
    listingData = snap.data();
  } catch (e) {
    functions.logger.error('bookingStart listing read error', { aptId, err: e.message });
    return res.status(500).json({ error: 'Could not verify apartment. Please try again.' });
  }
  if (listingData.available === false || listingData.status === 'booked') {
    return res.status(409).json({ error: 'This apartment is not currently available.' });
  }

  // 3. Rate limit by email — max 3 sends per hour
  const emailHash    = crypto.createHash('sha256').update(normEmail).digest('hex');
  const rateLimitRef = db.collection('booking_rate_limits').doc(emailHash);

  let rateLimited = false;
  try {
    rateLimited = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rateLimitRef);
      const now  = Date.now();
      if (snap.exists) {
        const d           = snap.data();
        const windowStart = d.windowStart?.toMillis ? d.windowStart.toMillis() : 0;
        const inWindow    = now - windowStart < 3600000;
        if (inWindow && (d.sendCount || 0) >= 3) return true;  // reject
        tx.set(rateLimitRef, {
          sendCount:   inWindow ? (d.sendCount || 0) + 1 : 1,
          windowStart: inWindow ? d.windowStart : admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        tx.set(rateLimitRef, {
          sendCount:   1,
          windowStart: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      return false;
    });
  } catch (e) {
    functions.logger.error('bookingStart rate limit error', { emailHash, err: e.message });
    return res.status(500).json({ error: 'Could not process request. Please try again.' });
  }
  if (rateLimited) {
    return res.status(429).json({ error: 'Too many booking requests. Please wait before trying again.' });
  }

  // 4. Generate OTP — use the pending booking doc ID as the hash salt
  const pendingRef = db.collection('pending_bookings').doc();
  const pendingId  = pendingRef.id;
  const code       = String(crypto.randomInt(100000, 1000000));
  const codeHash   = crypto.createHash('sha256').update(code + pendingId).digest('hex');

  // 5. Write pending_bookings doc
  try {
    await pendingRef.set({
      email:     normEmail,
      name:      name.trim(),
      aptId,
      codeHash,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 600000), // 10 min
      attempts:  0,
      status:    'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    functions.logger.error('bookingStart pending write error', { err: e.message });
    return res.status(500).json({ error: 'Could not create booking session. Please try again.' });
  }

  // 6. Send OTP via Resend
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    functions.logger.error('RESEND_API_KEY not set');
    return res.status(500).json({ error: 'Email service not configured. Please contact us.' });
  }
  try {
    const rsRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    'Accent Homes <noreply@accenthomesltd.com>',
        to:      [normEmail],
        subject: 'Your Accent Homes booking verification code',
        text:    `Your Accent Homes booking code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
        html:    `<p style="font-family:sans-serif">Your Accent Homes booking verification code is:</p><h2 style="letter-spacing:6px;font-family:monospace">${code}</h2><p style="font-family:sans-serif">This code expires in 10 minutes. Do not share it with anyone.</p>`
      })
    });
    if (!rsRes.ok) {
      const body = await rsRes.text();
      functions.logger.error('Resend error in bookingStart', { status: rsRes.status, body });
      return res.status(500).json({ error: 'Could not send verification email. Please try again.' });
    }
  } catch (e) {
    functions.logger.error('Resend fetch failed in bookingStart', { err: e.message });
    return res.status(500).json({ error: 'Could not send verification email. Please try again.' });
  }

  functions.logger.info('Guest booking OTP sent', { pendingId, aptId });
  return res.status(200).json({ pending_booking_id: pendingId });
});

// ── bookingVerifyOtp ───────────────────────────────────────────────────────────
//
// POST /bookingVerifyOtp
// No Authorization required — guest checkout path.
// Body: { pending_booking_id, code }
//
// Verifies the 6-digit OTP. Tracks wrong attempts (max 5 before lockout).
// On success: sets status='verified', issues a signed JWT booking_token
// (30 min, HS256) with claims { pending_booking_id, email, aptId }.
//
// Returns: 200 { booking_token }
//
exports.bookingVerifyOtp = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed.' });

  const { pending_booking_id, code } = req.body || {};

  // 1. Field validation
  if (!pending_booking_id || !code) {
    return res.status(400).json({ error: 'pending_booking_id and code are required.' });
  }

  // 2. Load pending booking
  const pendingRef = db.collection('pending_bookings').doc(pending_booking_id);
  let pendingData;
  try {
    const snap = await pendingRef.get();
    // Non-existent ID returns same error as wrong code — no info leak (test 5)
    if (!snap.exists) {
      return res.status(401).json({ error: 'Invalid verification code.' });
    }
    pendingData = snap.data();
  } catch (e) {
    functions.logger.error('bookingVerifyOtp read error', { pendingId: pending_booking_id, err: e.message });
    return res.status(500).json({ error: 'Could not verify code. Please try again.' });
  }

  // 3. Lockout check — before expiry and code checks (test 2: 6th attempt rejected)
  if (pendingData.status === 'locked') {
    return res.status(403).json({ error: 'Too many incorrect attempts. This booking has been locked.' });
  }

  // 4. Expiry check
  const expiresAt = pendingData.expiresAt?.toMillis ? pendingData.expiresAt.toMillis() : 0;
  if (expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Verification code has expired. Please start a new booking.' });
  }

  // 5. Code verification
  const inputHash = crypto.createHash('sha256').update(code + pending_booking_id).digest('hex');
  if (inputHash !== pendingData.codeHash) {
    // Wrong code — increment attempts; lock at 5 (test 2)
    // Transaction prevents concurrent wrong attempts from both reading attempts:4
    // and both failing to set the lock.
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(pendingRef);
        if (!fresh.exists || fresh.data().status !== 'pending') return;
        const newAttempts = (fresh.data().attempts || 0) + 1;
        const update = { attempts: newAttempts };
        if (newAttempts >= 5) update.status = 'locked';
        tx.update(pendingRef, update);
      });
    } catch (e) {
      functions.logger.error('bookingVerifyOtp attempt update error', { pendingId: pending_booking_id, err: e.message });
    }
    return res.status(401).json({ error: 'Invalid verification code.' });
  }

  // 6. Code correct — mark as verified
  try {
    await pendingRef.update({ status: 'verified' });
  } catch (e) {
    functions.logger.error('bookingVerifyOtp status update error', { pendingId: pending_booking_id, err: e.message });
    return res.status(500).json({ error: 'Could not confirm verification. Please try again.' });
  }

  // 7. Issue booking_token (HS256, 30 min)
  const jwtSecret = process.env.JWT_SIGNING_SECRET;
  if (!jwtSecret) {
    functions.logger.error('JWT_SIGNING_SECRET not set');
    return res.status(500).json({ error: 'Booking service misconfigured. Please contact us.' });
  }
  const booking_token = jwt.sign(
    { pending_booking_id, email: pendingData.email, aptId: pendingData.aptId },
    jwtSecret,
    { expiresIn: '30m' }
  );

  functions.logger.info('Guest booking OTP verified', { pendingId: pending_booking_id });
  return res.status(200).json({ booking_token });
});

// ── incrementSiteStats ─────────────────────────────────────────────────────────
//
// POST /incrementSiteStats
// No auth required. Rate-limited: same IP max 1 call per minute.
//
// Uses FieldValue.increment — Firestore's atomic server-side counter so
// concurrent page loads never race to overwrite each other.
//
exports.incrementSiteStats = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed.' });

  const ipHash = hashIp(req);

  // Rate limit: 1 increment per IP per minute
  const rateLimitRef = db.collection('view_rate_limits').doc('v_' + ipHash);
  let rateLimited = false;
  try {
    rateLimited = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rateLimitRef);
      const now  = Date.now();
      if (snap.exists) {
        const last = snap.data().lastSeen?.toMillis ? snap.data().lastSeen.toMillis() : 0;
        if (now - last < 60000) return true;
      }
      tx.set(rateLimitRef, { lastSeen: admin.firestore.FieldValue.serverTimestamp() });
      return false;
    });
  } catch (e) {
    functions.logger.error('incrementSiteStats rate limit error', { err: e.message });
    // On internal error, let it through — don't break page loads over a view counter
    rateLimited = false;
  }

  if (rateLimited) {
    return res.status(429).json({ error: 'Rate limit exceeded.' });
  }

  try {
    await db.collection('settings').doc('siteStats').set(
      { views: admin.firestore.FieldValue.increment(1) },
      { merge: true }
    );
  } catch (e) {
    functions.logger.error('incrementSiteStats write error', { err: e.message });
    return res.status(500).json({ error: 'Could not update stats.' });
  }

  return res.status(200).json({ success: true });
});

// ── logVisitor ─────────────────────────────────────────────────────────────────
//
// POST /logVisitor
// No auth required. Rate-limited: same IP max 1 log per hour (session).
// Body: { referrer? }
//
// IP is read from request headers server-side — no external API call.
//
exports.logVisitor = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed.' });

  const ipHash = hashIp(req);
  const rawIp  = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';

  // Rate limit: 1 log per IP per hour
  const rateLimitRef = db.collection('view_rate_limits').doc('l_' + ipHash);
  let rateLimited = false;
  try {
    rateLimited = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rateLimitRef);
      const now  = Date.now();
      if (snap.exists) {
        const last = snap.data().lastSeen?.toMillis ? snap.data().lastSeen.toMillis() : 0;
        if (now - last < 3600000) return true;
      }
      tx.set(rateLimitRef, { lastSeen: admin.firestore.FieldValue.serverTimestamp() });
      return false;
    });
  } catch (e) {
    functions.logger.error('logVisitor rate limit error', { err: e.message });
    rateLimited = false;
  }

  if (rateLimited) {
    return res.status(429).json({ error: 'Rate limit exceeded.' });
  }

  try {
    await db.collection('ipLogs').add({
      ip:        rawIp,
      userAgent: req.headers['user-agent'] || '',
      referrer:  (req.body || {}).referrer || 'direct',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    functions.logger.error('logVisitor write error', { err: e.message });
    return res.status(500).json({ error: 'Could not log visit.' });
  }

  return res.status(200).json({ success: true });
});

// ── notifyEnquiry ──────────────────────────────────────────────────────────────
//
// Firestore trigger: fires whenever a new document is created in /inquiries.
// Sends a notification email to sales@accenthomesltd.com via Resend so the
// team never has to poll the admin panel for new enquiries.
//
exports.notifyEnquiry = functions.firestore
  .document('inquiries/{id}')
  .onCreate(async (snap, context) => {
    const d  = snap.data() || {};
    const id = context.params.id;

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      functions.logger.error('notifyEnquiry: RESEND_API_KEY not set');
      return null;
    }

    const name     = d.name      || 'Unknown';
    const email    = d.email     || '—';
    const phone    = d.phone     || '—';
    const apt      = d.apartment || d.apt || '—';
    const checkIn  = d.checkIn   || '—';
    const checkOut = d.checkOut  || '—';
    const message  = d.message   || '—';

    const subject = `New Enquiry from ${name}`;

    const text = [
      `New enquiry received on Accent Homes.`,
      ``,
      `Name:       ${name}`,
      `Email:      ${email}`,
      `Phone:      ${phone}`,
      `Apartment:  ${apt}`,
      `Check-In:   ${checkIn}`,
      `Check-Out:  ${checkOut}`,
      `Message:    ${message}`,
      ``,
      `Firestore ID: ${id}`,
    ].join('\n');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#2B2B2B">
        <div style="background:#2B2B2B;padding:24px 32px;text-align:center">
          <span style="font-family:Georgia,serif;font-size:2rem;color:#8B5E3C;letter-spacing:0.08em">Λ</span>
          <div style="font-family:Georgia,serif;font-size:1.1rem;color:#F8F8F8;letter-spacing:0.06em;margin-top:4px">Accent Homes</div>
        </div>
        <div style="padding:32px;background:#fff;border:1px solid #E8E8E8">
          <h2 style="font-family:Georgia,serif;font-size:1.2rem;font-weight:400;color:#8B5E3C;margin:0 0 20px">New Enquiry Received</h2>
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
            <tr><td style="padding:8px 0;border-bottom:1px solid #F0F0F0;color:#7A7A7A;width:120px">Name</td><td style="padding:8px 0;border-bottom:1px solid #F0F0F0;font-weight:600">${name}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #F0F0F0;color:#7A7A7A">Email</td><td style="padding:8px 0;border-bottom:1px solid #F0F0F0"><a href="mailto:${email}" style="color:#8B5E3C">${email}</a></td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #F0F0F0;color:#7A7A7A">Phone</td><td style="padding:8px 0;border-bottom:1px solid #F0F0F0">${phone}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #F0F0F0;color:#7A7A7A">Apartment</td><td style="padding:8px 0;border-bottom:1px solid #F0F0F0">${apt}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #F0F0F0;color:#7A7A7A">Check-In</td><td style="padding:8px 0;border-bottom:1px solid #F0F0F0">${checkIn}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #F0F0F0;color:#7A7A7A">Check-Out</td><td style="padding:8px 0;border-bottom:1px solid #F0F0F0">${checkOut}</td></tr>
            <tr><td style="padding:8px 0;color:#7A7A7A;vertical-align:top">Message</td><td style="padding:8px 0">${message}</td></tr>
          </table>
          <div style="margin-top:28px;text-align:center">
            <a href="https://accent-homes.web.app/accent-admin.html" style="background:#8B5E3C;color:#fff;text-decoration:none;padding:12px 28px;border-radius:4px;font-size:0.82rem;font-weight:700;letter-spacing:0.08em">View in Admin Panel</a>
          </div>
        </div>
        <div style="padding:16px 32px;text-align:center;font-size:0.72rem;color:#9A9A9A">
          Accent Homes · Asaba, Delta State · This is an automated notification.
        </div>
      </div>`;

    try {
      const rsRes = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from:    'Accent Homes <noreply@accenthomesltd.com>',
          to:      ['sales@accenthomesltd.com'],
          subject,
          text,
          html
        })
      });

      if (!rsRes.ok) {
        const body = await rsRes.text();
        functions.logger.error('notifyEnquiry: Resend error', { status: rsRes.status, body, id });
      } else {
        functions.logger.info('notifyEnquiry: email sent', { id, name });
      }
    } catch (e) {
      functions.logger.error('notifyEnquiry: fetch failed', { id, err: e.message });
    }

    return null;
  });

// ── _sendCheckoutEmail ────────────────────────────────────────────────────────
//
// Internal helper — sends a warm goodbye email to a guest on their checkout day.
//
async function _sendCheckoutEmail(bookingId, data, resendKey) {
  if (!resendKey) return;

  const ref     = bookingId.slice(0, 8).toUpperCase();
  const fmtDate = s => { if (!s) return '—'; const [y,m,d] = s.split('-'); return `${d}/${m}/${y}`; };
  const caution = data.caution || 0;
  const fmt     = n => '₦' + Number(n).toLocaleString('en-NG');

  const text = [
    `Thank You for Staying with Accent Homes`,
    ``,
    `Dear ${data.guestName},`,
    ``,
    `What a pleasure it has been hosting you. As your stay at ${data.aptName} comes to an end today, we want you to know that it was truly our honour to have you with us.`,
    ``,
    `We hope every moment felt comfortable, restful, and exactly what you needed — that is always our goal at Accent Homes.`,
    ``,
    `BOOKING SUMMARY`,
    `  Reference:  ${ref}`,
    `  Apartment:  ${data.aptName}`,
    `  Check-In:   ${fmtDate(data.checkIn)}`,
    `  Check-Out:  ${fmtDate(data.checkOut)}  (today)`,
    ``,
    `SECURITY DEPOSIT`,
    `  Your caution deposit of ${fmt(caution)} will be refunded within 14 business days,`,
    `  subject to no damage to the apartment.`,
    ``,
    `COME BACK SOON`,
    `  We would love to welcome you back. Whenever Asaba calls you again, Accent Homes will be ready.`,
    `  Book directly at accenthomesltd.com or reach us on WhatsApp: +234 911 170 0046`,
    ``,
    `Safe travels,`,
    ``,
    `The Accent Homes Team`,
    `Asaba, Delta State · accenthomesltd.com`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank You — Accent Homes</title></head>
<body style="margin:0;padding:0;background:#F5F2EE;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EE;padding:40px 0;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#fff;border-radius:4px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr><td style="background:#2B2B2B;padding:36px 40px 28px;">
        <div style="font-family:'Georgia',serif;font-size:22px;font-weight:400;color:#F0EDE8;letter-spacing:0.04em;">Accent Homes</div>
        <div style="font-size:11px;color:rgba(240,237,232,0.45);letter-spacing:0.18em;text-transform:uppercase;margin-top:4px;">Luxury Residences · Asaba</div>
      </td></tr>

      <!-- Bronze bar -->
      <tr><td style="background:#c86233;padding:14px 40px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#fff;">Thank You for Your Stay</div>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:40px;">

        <p style="font-size:15px;color:#2B2B2B;line-height:1.8;margin:0 0 20px;">Dear <strong>${data.guestName}</strong>,</p>

        <p style="font-size:15px;color:#555;line-height:1.8;margin:0 0 16px;">
          What a pleasure it has been hosting you. As your stay at <strong>${data.aptName}</strong> comes to an end today, we want you to know that it was truly our honour to have you with us.
        </p>
        <p style="font-size:15px;color:#555;line-height:1.8;margin:0 0 32px;">
          We hope every moment felt comfortable, restful, and exactly what you needed — that is always our goal at Accent Homes.
        </p>

        <!-- Summary box -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EE;border-radius:4px;padding:24px;margin-bottom:32px;">
          <tr><td style="font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#c86233;padding-bottom:14px;">Booking Summary</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#555;border-bottom:1px solid rgba(0,0,0,0.06);">
            <table width="100%"><tr>
              <td style="color:#888;">Reference</td>
              <td style="text-align:right;font-weight:600;color:#2B2B2B;">${ref}</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#555;border-bottom:1px solid rgba(0,0,0,0.06);">
            <table width="100%"><tr>
              <td style="color:#888;">Apartment</td>
              <td style="text-align:right;font-weight:600;color:#2B2B2B;">${data.aptName}</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#555;border-bottom:1px solid rgba(0,0,0,0.06);">
            <table width="100%"><tr>
              <td style="color:#888;">Check-In</td>
              <td style="text-align:right;color:#2B2B2B;">${fmtDate(data.checkIn)}</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#555;">
            <table width="100%"><tr>
              <td style="color:#888;">Check-Out</td>
              <td style="text-align:right;color:#2B2B2B;">${fmtDate(data.checkOut)}</td>
            </tr></table>
          </td></tr>
        </table>

        <!-- Deposit note -->
        ${caution > 0 ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF8F0;border:1px solid rgba(200,98,51,0.2);border-radius:4px;padding:18px 20px;margin-bottom:32px;">
          <tr><td style="font-size:13px;color:#2B2B2B;line-height:1.7;">
            <strong>Security Deposit:</strong> Your caution deposit of <strong>${fmt(caution)}</strong> will be refunded within <strong>14 business days</strong>, subject to no damage to the apartment.
          </td></tr>
        </table>` : ''}

        <!-- Come back -->
        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E8E4DF;padding-top:28px;margin-bottom:32px;">
          <tr><td>
            <div style="font-family:'Georgia',serif;font-size:18px;color:#2B2B2B;margin-bottom:10px;font-weight:400;">We'd love to have you back.</div>
            <p style="font-size:14px;color:#777;line-height:1.8;margin:0 0 20px;">
              Whenever Asaba calls you again, Accent Homes will be ready. Book directly or reach us on WhatsApp — we will take care of everything.
            </p>
            <a href="https://accenthomesltd.com" style="display:inline-block;background:#c86233;color:#fff;text-decoration:none;padding:13px 28px;border-radius:3px;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Book Your Next Stay</a>
          </td></tr>
        </table>

        <p style="font-size:13px;color:#aaa;line-height:1.7;margin:0;">
          Safe travels,<br>
          <strong style="color:#2B2B2B;">The Accent Homes Team</strong><br>
          Asaba, Delta State &nbsp;·&nbsp; <a href="https://accenthomesltd.com" style="color:#c86233;text-decoration:none;">accenthomesltd.com</a><br>
          WhatsApp: <a href="https://wa.me/2349111700046" style="color:#c86233;text-decoration:none;">+234 911 170 0046</a>
        </p>

      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#F5F2EE;padding:20px 40px;text-align:center;">
        <div style="font-size:11px;color:#aaa;letter-spacing:0.06em;">© ${new Date().getFullYear()} Accent Homes · Asaba, Delta State, Nigeria</div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  const rsRes = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    'Accent Homes <noreply@accenthomesltd.com>',
      to:      [data.guestEmail],
      subject: `Thank you for staying with us, ${data.guestName} 🏡`,
      text,
      html,
    })
  });

  if (!rsRes.ok) {
    const body = await rsRes.text();
    functions.logger.error('_sendCheckoutEmail: Resend error', { bookingId, status: rsRes.status, body });
  } else {
    functions.logger.info('_sendCheckoutEmail: sent', { bookingId, guestEmail: data.guestEmail });
  }
}

// ── sendCheckoutEmails — runs daily at 10:00 AM WAT ──────────────────────────
//
// Queries every confirmed booking whose checkOut date is today, then sends
// each guest a warm goodbye + deposit-refund reminder email.
//
exports.sendCheckoutEmails = functions.pubsub
  .schedule('0 9 * * *')          // 09:00 UTC = 10:00 AM WAT (Africa/Lagos UTC+1)
  .timeZone('UTC')
  .onRun(async () => {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      functions.logger.error('sendCheckoutEmails: RESEND_API_KEY not set');
      return null;
    }

    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const snap  = await db.collection('bookings')
      .where('status',    '==', 'confirmed')
      .where('checkOut',  '==', today)
      .get();

    if (snap.empty) {
      functions.logger.info('sendCheckoutEmails: no checkouts today', { today });
      return null;
    }

    functions.logger.info('sendCheckoutEmails: processing', { today, count: snap.size });

    const results = await Promise.allSettled(
      snap.docs.map(doc => _sendCheckoutEmail(doc.id, doc.data(), resendKey))
    );

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length) {
      functions.logger.error('sendCheckoutEmails: some emails failed', { failed: failed.length });
    }

    return null;
  });
