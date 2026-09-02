'use strict';

/**
 * Thin wrapper around the `web-push` package: generates/loads a VAPID
 * keypair on first run and sends notifications to all stored subscriptions,
 * pruning any that the push service reports as gone (410/404).
 *
 * NOTE: this file requires the `web-push` npm package. It could not be
 * executed inside the build sandbox (no npm registry access there — see
 * README "หมายเหตุสำคัญสำหรับผู้ที่ต้องการแก้ไขโค้ด" section) but the API used
 * here (webpush.generateVAPIDKeys / setVapidDetails / sendNotification)
 * matches the documented, stable web-push v3 API.
 */

const webpush = require('web-push');
const store = require('./store');

function getOrCreateVapidKeys() {
  let keys = store.loadVapid();
  if (!keys || !keys.publicKey || !keys.privateKey) {
    keys = webpush.generateVAPIDKeys();
    store.saveVapid(keys);
    console.log('[push] Generated new VAPID keypair and saved to data/vapid.json');
  }
  return keys;
}

function initPush({ contactEmail } = {}) {
  const keys = getOrCreateVapidKeys();
  const subject = contactEmail ? `mailto:${contactEmail}` : 'mailto:admin@example.com';
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  return keys;
}

/**
 * Send `payloadObj` (will be JSON.stringify'd) to every stored subscription.
 * Returns { sent, removed } counts. Automatically removes subscriptions the
 * push service reports as no-longer-valid (typical after the user
 * uninstalls the PWA or disables notifications).
 */
async function sendToAll(payloadObj) {
  const subs = store.loadSubscriptions();
  if (subs.length === 0) return { sent: 0, removed: 0 };

  const payload = JSON.stringify(payloadObj);
  let sent = 0;
  const stillValid = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
        sent += 1;
        stillValid.push(sub);
      } catch (err) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) {
          // subscription expired/unsubscribed on the browser side — drop it
        } else {
          console.error('[push] send failed:', code, err && err.message);
          // keep it — could be a transient network error, not a dead subscription
          stillValid.push(sub);
        }
      }
    })
  );

  const removed = subs.length - stillValid.length;
  if (removed > 0) store.saveSubscriptions(stillValid);
  return { sent, removed };
}

module.exports = { initPush, getOrCreateVapidKeys, sendToAll };
