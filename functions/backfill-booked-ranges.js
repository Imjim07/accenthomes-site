'use strict';

/**
 * One-time backfill — run from the functions/ folder:
 *   node backfill-booked-ranges.js
 *
 * Uses Application Default Credentials (already set by `firebase login`).
 * No service-account JSON key needed.
 */

const admin = require('firebase-admin');

admin.initializeApp();          // picks up GOOGLE_APPLICATION_CREDENTIALS or gcloud auth
const db = admin.firestore();

async function backfill() {
  const snap = await db.collection('bookings')
    .where('status', '==', 'confirmed')
    .get();

  if (snap.empty) {
    console.log('No confirmed bookings found.');
    return;
  }

  console.log(`Found ${snap.docs.length} confirmed booking(s). Writing booked_ranges…`);

  const batch = db.batch();
  let count = 0;

  for (const doc of snap.docs) {
    const { aptId, checkIn, checkOut } = doc.data();
    if (!aptId || !checkIn || !checkOut) {
      console.warn(`  SKIP ${doc.id} — missing aptId/checkIn/checkOut`);
      continue;
    }
    batch.set(
      db.collection('listings').doc(aptId)
        .collection('booked_ranges').doc(doc.id),
      { checkIn, checkOut }
    );
    console.log(`  ${doc.id}  ${checkIn} → ${checkOut}  (apt: ${aptId})`);
    count++;
  }

  await batch.commit();
  console.log(`\n✓ Done — ${count} doc(s) written.`);
}

backfill().catch(e => { console.error(e.message); process.exit(1); });
