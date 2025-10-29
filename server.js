require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const Stripe = require("stripe");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  console.error("❌ STRIPE_SECRET_KEY not set");
  process.exit(1);
}
const stripe = Stripe(stripeSecret);

const PORT = process.env.PORT || 4242;
const CSV_FILE = path.join(__dirname, "leads.csv");

/* =====================================================
   💳 Create Subscription (Card or Bank)
   ===================================================== */
app.post("/create-subscription", async (req, res) => {
  try {
    const { email, priceId, paymentMethodType, paymentMethodId } = req.body;
    if (!email || !priceId)
      return res.status(400).json({ error: "Missing email or priceId" });

    // 1️⃣ Find or create customer
    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer =
      existing.data[0] || (await stripe.customers.create({ email }));

    // 2️⃣ Attach existing payment method or create one
    let paymentMethod = paymentMethodId;
    if (!paymentMethod) {
      const pm = await stripe.paymentMethods.create({
        type: paymentMethodType || "card",
        billing_details: { email },
      });
      paymentMethod = pm.id;
      await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
    }

    // 3️⃣ Set default payment method
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethod },
    });

    // 4️⃣ Create subscription (server-side confirm)
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
      off_session: true,
    });

    // 5️⃣ Confirm the PaymentIntent internally (no modal)
    const pi = subscription.latest_invoice.payment_intent;
    const confirmed = await stripe.paymentIntents.confirm(pi.id, {
      payment_method: paymentMethod,
    });

    // 6️⃣ Log lead
    const line = `${new Date().toISOString()},${email},subscription,${priceId},${confirmed.id},${confirmed.status}\n`;
    fs.appendFileSync(CSV_FILE, line);

    res.json({
      subscriptionId: subscription.id,
      clientSecret: confirmed.client_secret,
      status: confirmed.status,
    });
  } catch (err) {
    console.error("Subscription error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =====================================================
   🏦 Collect Bank Details (ACH SetupIntent)
   ===================================================== */
app.post("/create-bank-setup-intent", async (req, res) => {
  try {
    const { email } = req.body;
    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer =
      existing.data[0] || (await stripe.customers.create({ email }));

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ["us_bank_account"],
    });

    res.json({
      clientSecret: setupIntent.client_secret,
      customerId: customer.id,
    });
  } catch (err) {
    console.error("Bank setup error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =====================================================
   🧾 One-time payment (same as before)
   ===================================================== */
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount, currency, email } = req.body;
    if (!amount || amount <= 0)
      return res.status(400).json({ error: "Invalid amount" });

    const pi = await stripe.paymentIntents.create({
      amount,
      currency,
      receipt_email: email,
      automatic_payment_methods: { enabled: true },
    });

    res.json({ clientSecret: pi.client_secret });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* =====================================================
   🧾 Log leads
   ===================================================== */
app.post("/save-lead", async (req, res) => {
  try {
    const { email, status, amount, pi, reason } = req.body;
    const line = `${new Date().toISOString()},${email},${status},${amount},${pi || ""},${reason || ""}\n`;
    fs.appendFileSync(CSV_FILE, line);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(__dirname));
app.listen(PORT, () => console.log("✅ Server running on port", PORT));
