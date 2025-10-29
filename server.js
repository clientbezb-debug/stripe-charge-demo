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

const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  console.error('❌ Error: STRIPE_SECRET_KEY not set');
  process.exit(1);
}
const stripe = Stripe(stripeSecret);

const PORT = process.env.PORT || 4242;
const CSV_FILE = path.join(__dirname, 'leads.csv');


// 💳 ONE-TIME PAYMENT INTENT
app.post('/create-payment-intent', async (req, res) => {
  try {
    let { amount, currency, email, ref } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    currency = currency ? currency.toLowerCase() : 'usd';
    const allowedCurrencies = ['usd', 'gbp', 'eur'];
    if (!allowedCurrencies.includes(currency)) {
      return res.status(400).json({ error: 'Invalid currency. Use USD, GBP, or EUR.' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      ...(email ? { receipt_email: email } : {}),
      automatic_payment_methods: { enabled: true },
      metadata: { ref: ref || '' },
    });

    const successLink = `https://your-frontend.com/confirmation?ref=${encodeURIComponent(ref || '')}`;

    res.json({
      clientSecret: paymentIntent.client_secret,
      ref: ref || null,
      currency: currency.toUpperCase(),
      link: successLink,
      status: paymentIntent.status
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// 🔁 SUBSCRIPTION CREATION
app.post('/create-subscription', async (req, res) => {
  try {
    const { email, priceId, paymentMethodType, ref } = req.body;

    if (!priceId) {
      return res.status(400).json({ error: 'Missing price ID' });
    }

    // 1️⃣ Create or reuse customer (email optional)
    const customer = await stripe.customers.create({
      ...(email ? { email } : {}),
      description: 'Auto-created customer',
    });

    // 2️⃣ Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// 🧾 LOG TO CSV
app.post('/save-lead', async (req, res) => {
  try {
    const { email, status, amount, pi, reason, ref } = req.body;

    const line = `${new Date().toISOString()},${email || ''},${status || ''},${amount || ''},${pi || ''},${reason || ''},${ref || ''}\n`;
    fs.appendFileSync(CSV_FILE, line);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// 🧠 DEBUG ROUTE
app.get('/debug-env', (req, res) => {
  res.json({ stripeKeySet: !!process.env.STRIPE_SECRET_KEY });
});


// STATIC FRONTEND
app.use(express.static(__dirname));


// 🚀 START SERVER
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
