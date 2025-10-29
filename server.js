// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 🔐 Load Stripe key from environment variable
const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  console.error('❌ Error: STRIPE_SECRET_KEY not set');
  process.exit(1);
}
const stripe = Stripe(stripeSecret);

const PORT = process.env.PORT || 4242;
const CSV_FILE = path.join(__dirname, 'leads.csv');

/* ==========================================================
   💳  ONE-TIME PAYMENT
   Creates a single charge using Payment Intents API
   ========================================================== */
app.post('/create-payment-intent', async (req, res) => {
  try {
    let { amount, currency, email, ref } = req.body;

    if (!amount || amount <= 0)
      return res.status(400).json({ error: 'Invalid amount' });

    currency = currency ? currency.toLowerCase() : 'usd';
    const allowedCurrencies = ['usd', 'gbp', 'eur'];
    if (!allowedCurrencies.includes(currency))
      return res.status(400).json({ error: 'Invalid currency. Use USD, GBP, or EUR.' });

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      ...(email ? { receipt_email: email } : {}),
      automatic_payment_methods: { enabled: true },
      metadata: { ref: ref || '' },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      ref: ref || null,
      currency: currency.toUpperCase(),
      status: paymentIntent.status,
    });
  } catch (err) {
    console.error('❌ Payment error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================================================
   🔁  SUBSCRIPTION PAYMENT
   Creates a recurring charge using Subscriptions API
   ========================================================== */
app.post('/create-subscription', async (req, res) => {
  try {
    const { amount, currency, email, ref, paymentMethodType, interval } = req.body;

    if (!amount || amount <= 0)
      return res.status(400).json({ error: 'Invalid amount' });

    const safeCurrency = (currency || 'usd').toLowerCase();

    // ✅ Reuse or create customer
    let customer;
    if (email) {
      const existing = await stripe.customers.list({ email, limit: 1 });
      customer = existing.data.length ? existing.data[0] : await stripe.customers.create({ email });
    } else {
      customer = await stripe.customers.create();
    }

    // ✅ Create subscription with dynamic pricing
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [
        {
          price_data: {
            currency: safeCurrency,
            product_data: { name: `Custom Plan (${ref || 'manual'})` },
            unit_amount: amount,
            recurring: { interval: interval || 'month' },
          },
        },
      ],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: { ref: ref || '' },
    });

    const invoice = subscription.latest_invoice;
    const paymentIntent = invoice.payment_intent;

    res.json({
      subscriptionId: subscription.id,
      clientSecret: paymentIntent.client_secret,
      status: subscription.status,
      ref: ref || null,
    });
  } catch (err) {
    console.error('❌ Subscription error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================================================
   🧾  SAVE LEAD DATA TO CSV
   ========================================================== */
app.post('/save-lead', async (req, res) => {
  try {
    const { email, status, amount, pi, reason, ref } = req.body;
    const line = `${new Date().toISOString()},${email || ''},${status || ''},${amount || ''},${pi || ''},${reason || ''},${ref || ''}\n`;
    fs.appendFileSync(CSV_FILE, line);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ CSV error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ==========================================================
   🧠  DEBUG ROUTE
   ========================================================== */
app.get('/debug-env', (req, res) => {
  res.json({ stripeKeySet: !!process.env.STRIPE_SECRET_KEY });
});

/* ==========================================================
   🌐  STATIC FRONTEND
   ========================================================== */
app.use(express.static(__dirname));

/* ==========================================================
   🚀  START SERVER
   ========================================================== */
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
