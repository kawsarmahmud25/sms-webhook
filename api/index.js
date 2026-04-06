const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Webhook is Live & Ready! 🚀');
  }

  const sender = req.body.sender || req.query.sender;
  const message = req.body.message || req.query.message;

  if (!message) return res.status(400).send("No message");

  let trxMatch = message.match(/TrxID\s*[:\-]?\s*([A-Z0-9]+)/i);
  let amountMatch = message.match(/Tk\s*([0-9,.]+)/i);

  if (trxMatch && amountMatch) {
      const smsTrxId = trxMatch[1].trim();
      const smsAmount = parseFloat(amountMatch[1].replace(/,/g, ""));

      try {
          const snapshot = await db.collection("add_money_requests")
              .where("trxId", "==", smsTrxId)
              .where("status", "==", "Pending")
              .get();

          if (!snapshot.empty) {
              const requestDoc = snapshot.docs[0];
              const requestData = requestDoc.data();

              if (parseFloat(requestData.amount) === smsAmount) {
                  const userRef = db.collection("users").doc(requestData.userId);
                  
                  await db.runTransaction(async (t) => {
                      const userDoc = await t.get(userRef);
                      const newBalance = (userDoc.data().balance || 0) + smsAmount;
                      
                      t.update(userRef, { balance: newBalance });
                      t.update(requestDoc.ref, { status: "Approved" });
                  });
                  return res.status(200).send("Success! Money Added: " + smsTrxId);
              }
          }
      } catch (error) {
          console.error("Error:", error);
          return res.status(500).send("Server Error");
      }
  }
  return res.status(200).send("SMS Received!");
}
