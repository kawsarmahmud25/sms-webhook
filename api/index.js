const express = require('express');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());

// Firebase Admin Setup (Vercel Environment Variable থেকে নিবে)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
}
const db = admin.firestore();

app.post('/api', async (req, res) => {
    try {
        const { sender, message } = req.body;

        if (!message) {
            return res.status(400).send("No message provided");
        }

        console.log(`New SMS from ${sender}: ${message}`);

        // রেজেক্স: বিকাশ এবং নগদ উভয়ের জন্য TrxID ও Amount বের করা
        const trxIdMatch = message.match(/(?:TrxID|TxnID)[:\s]+([A-Z0-9]+)/i);
        const amountMatch = message.match(/(?:received Tk|Amount:\s*Tk)\s*([\d,.]+)/i);

        if (!trxIdMatch || !amountMatch) {
            return res.status(200).send("Not a valid Add Money SMS. Ignored.");
        }

        const smsTrxId = trxIdMatch[1].trim();
        const smsAmount = parseFloat(amountMatch[1].replace(/,/g, ''));

        console.log(`Extracted -> TrxID: ${smsTrxId}, Amount: ${smsAmount}`);

        const requestsRef = db.collection('add_money_requests');
        const snapshot = await requestsRef
            .where('trxId', '==', smsTrxId)
            .where('status', '==', 'Pending')
            .get();

        // Pending রিকোয়েস্ট না পেলে Unclaimed এ সেভ করে রাখবে
        if (snapshot.empty) {
            await db.collection('unclaimed_payments').doc(smsTrxId).set({
                trxId: smsTrxId,
                amount: smsAmount,
                sender: sender,
                fullMessage: message,
                time: admin.firestore.FieldValue.serverTimestamp(),
                claimed: false
            });
            console.log("Saved to unclaimed_payments.");
            return res.status(200).send("Logged as unclaimed.");
        }

        // Pending রিকোয়েস্ট পাওয়া গেছে!
        const docId = snapshot.docs[0].id;
        const requestData = snapshot.docs[0].data();

        // Amount ঠিক আছে কিনা চেক করা
        if (requestData.amount === smsAmount) {
            const userId = requestData.userId;

            // Transaction এর মাধ্যমে ব্যালেন্স আপডেট
            await db.runTransaction(async (transaction) => {
                const userRef = db.collection('users').doc(userId);
                const reqRef = requestsRef.doc(docId);

                transaction.update(userRef, { balance: admin.firestore.FieldValue.increment(smsAmount) });
                transaction.update(reqRef, { status: 'Approved', approvedAt: admin.firestore.FieldValue.serverTimestamp() });
            });

            console.log("Auto-Approved successfully!");
            return res.status(200).send("Success: Balance added.");
        } else {
            // Amount না মিললে
            await requestsRef.doc(docId).update({ status: 'Amount Mismatch', actualSmsAmount: smsAmount });
            console.log("Amount mismatch!");
            return res.status(200).send("Amount mismatch.");
        }

    } catch (error) {
        console.error("Webhook Error:", error);
        return res.status(500).send("Internal Server Error");
    }
});

module.exports = app;
