const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SICRET);
const port = process.env.PORT || 3000
const crypto = require('crypto')
var admin = require("firebase-admin");

var serviceAccount = require('./zap-shift-firebase-adminsdk.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// generat id for traking
function generateTrackingId() {
  const prefix = "SHN";  // your brand/company code
  
  // date as YYYYMMDD
  const date = new Date()
    .toISOString()
    .slice(0,10)
    .replace(/-/g, "");

  // secure random string (Base36)
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();

  return `${prefix}-${date}-${random}`;
}
// middle ware
app.use(express.json());
app.use(cors());
const verifyToken = (req, res, next) =>{
 const token = req.headers. authorization;
  if(!token){
    return res.status(401).send({message: 'unauthorize access'})
  }

 next()
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.11tuu0x.mongodb.net/?appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const db = client.db('zap-shift-db');
    const parcelCollection = db.collection('parcels');
    const paymentCollection = db.collection('payment')


    // get one and all data match email
    app.get('/parcels', async(req,res)=>{
      const query = {}
      const {email} = req.query

      if(email){
        query.senderEmail = email
      }
      const cursor = parcelCollection.find(query).sort({ CreateAt: -1 });
      const result = await cursor.toArray();
      res.send(result)
    })


    // insert data mongodb 
    app.post('/parcels', async(req,res)=>{
      const parcel = req.body
      parcel.CreateAt = new Date();
      const result = await parcelCollection.insertOne(parcel)
      res.send(result)
    })
    // Delete a data in database
    app.delete('/parcels/:id', async(req,res) =>{
      const id = req.params.id;
      const query = { _id: new ObjectId(id)}
      const result = await parcelCollection.deleteOne(query)
      res.send(result)
    })
    // get one data for payment
    app.get('/parcels/:parcelId', async(req,res)=>{
      const id = req.params.parcelId;
      const query = {_id: new ObjectId(id)}
      const result = await parcelCollection.findOne(query)
      res.send(result)
    })

      // post for checkout section 
  //   app.post('/create-checkout-session', async (req, res)=>{
  //     const paymentInfo = req.body
  //     const session = await stripe.checkout.sessions.create({

  //     line_items: [
  //     {
       
  //       price_data: {
  //         currency : 'USD',
  //         unit_Amount: 1500,
  //         product_data:{
  //           name: paymentInfo.parcelName
  //         } 
  //       },
  //       quantity: 1,
  //     },
  //   ],
  //   customer_email: paymentInfo.senderEmail,
  //   mode: 'payment',
  //   success_url: `${process.env.SITE_DOMAIN}?/dashboard/payment-success`,
  // });

  // res.redirect(303, session.url);
  //     })

/////////////new api for payment
app.post('/create-checkout-section', async(req,res)=>{
  const paymentInfo = req.body
  console.log(paymentInfo)
  const amount = parseInt(paymentInfo.cost)*100
   const session = await stripe.checkout.sessions.create({
    
    line_items: [
      {
        price_data:{
          currency: 'USD',
          unit_amount: amount,
          product_data: {
            name: `${paymentInfo.parcelName}`
          }
        },
        quantity: 1,
      },
    ],
    metadata:{
      parcelName: paymentInfo.parcelName,
      parcelId: paymentInfo.parcelId,
      senderEmail: paymentInfo.senderEmail,
    },
    customer_email: paymentInfo.senderEmail,
    mode: "payment",
    success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,

  });

  res.send({ url: session.url });
})
// api for check
app.patch('/payment-success', async(req,res)=>{
  const sessionId = req.query.session_id;
   const session = await stripe.checkout.sessions.retrieve(sessionId);
  //  console.log(session)
  const transactionId = session.payment_intent;
  const query = {transactionId: transactionId}
  const paymentExist = await paymentCollection.findOne(query);
  if(paymentExist){
    return res.send({message:"trakingID", transactionId, trackingId: paymentExist.trackingId})
  }
   const trackingId = generateTrackingId();
   if(session.payment_status === 'paid'){ 
    const id = session.metadata.parcelId;
    const query = { _id: new ObjectId(id)}
    const update ={
      $set:{
        paymentStatus: 'paid',
        tracking: trackingId
      }
    }
    const result = await parcelCollection.updateOne(query, update)
    const payment = {
      amount: session.amount_total/100,
      currency: session.currency,
      customerEmail: session.customer_email || session.metadata.senderEmail || "example@get.com",
      parcelName: session.metadata.parcelName,
      parcelId: session.metadata.parcelId,
      transactionId: session.payment_intent,
      paymentStatus: session.payment_status,
      paidAt: new Date(),
      trackingId: trackingId
      
    }
     if(session.payment_status === 'paid'){  
      const paymentResult = await paymentCollection.insertOne(payment);
      res.send({
        modifyParcel: result,
        paymentInfo: paymentResult,
        success:true,
        transactionId: session.payment_intent,
        trackingId: trackingId,

      })
    }

   }

  res.send({success: false})
})

//payment history api
app.get('/payments', verifyToken, async(req,res)=>{
  const email = req.query.email;
  const query = {}
  console.log('headers', req.headers);
  if(email){
    query.customerEmail = email
  }
  const curser = paymentCollection.find(query);
  const result = await curser.toArray();
  res.send(result)


})
    
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("You are connected with MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);






app.get('/', (req, res) => {
  res.send('Zap shifting website is running!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})