require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4242;
const CSV_FILE = path.join(__dirname, 'leads.csv');

// Check Stripe key at startup
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('Error: STRIPE_SECRET_KEY not set');
  process.exit(1);
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Helper: escape CSV fields
function escapeCSVField(field) {
  if (!field) return '';
  const str = String(field);
  return `"${str.replace(/"/g, '""')}"`; // double quotes inside field
}

// Endpoint: create payment intent
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency, email } = req.body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (!currency || typeof currency !== 'string') {
      return res.status(400).json({ error: 'Invalid currency' });
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const pi = await stripe.paymentIntents.create({
      amount,
      currency,
      receipt_email: email,
      automatic_payment_methods: { enabled: true },
    });

    res.json({ clientSecret: pi.client_secret });
  } catch (err) {
    console.error('Payment Intent Error:', err.message);
    res.status(500).json({ error: 'Unable to create payment intent' });
  }
});

// Endpoint: save lead to CSV
app.post('/save-lead', async (req, res) => {
  try {
    const { email, status, amount, pi, reason } = req.body;

    if (!email || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const line = [
      new Date().toISOString(),
      email,
      status,
      amount || '',
      pi || '',
      reason || ''
    ].map(escapeCSVField).join(',') + '\n';

    await fs.appendFile(CSV_FILE, line, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    console.error('Save Lead Error:', err.message);
    res.status(500).json({ error: 'Unable to save lead' });
  }
});

// Serve static files from 'public' folder only
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
