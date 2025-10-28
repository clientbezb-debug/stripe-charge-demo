require('dotenv').config();
const express=require('express');
const bodyParser=require('body-parser');
const cors=require('cors');
const Stripe=require('stripe');
const fs=require('fs');
const path=require('path');

const app=express();
app.use(cors());
app.use(bodyParser.json());

const stripe=Stripe(process.env.STRIPE_SECRET_KEY||'');
const PORT=process.env.PORT||4242;
const CSV_FILE=path.join(__dirname,'leads.csv');

app.post('/create-payment-intent',async(req,res)=>{
  try{
    const {amount,currency,email}=req.body;
    if(!amount||amount<=0)return res.status(400).json({error:'Invalid amount'});
    const pi=await stripe.paymentIntents.create({amount,currency,receipt_email:email,automatic_payment_methods:{enabled:true}});
    res.json({clientSecret:pi.client_secret});
  }catch(err){console.error(err);res.status(500).json({error:err.message});}
});

app.post('/save-lead',async(req,res)=>{
  try{
    const {email,status,amount,pi,reason}=req.body;
    const line=`${new Date().toISOString()},${email},${status},${amount},${pi||''},${reason||''}\n`;
    fs.appendFileSync(CSV_FILE,line);
    res.json({ok:true});
  }catch(err){console.error(err);res.status(500).json({error:err.message});}
});

app.use(express.static(__dirname));
app.listen(PORT,()=>console.log('Server running on port',PORT));
