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
const { access } = require('fs');

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
// verifyToken
const verifyToken = async(req, res, next) =>{

 const token = req.headers?.authorization;
  //  console.log('after verify', token)
  if(!token){
    return res.status(401).send({message: 'unauthorize access'})
  }
  try{
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken)
    req.decoded_email = decoded.email
    console.log('after decoded : ', decoded);

     next()
  }
catch (err){
 return res.status(401).send({message: 'unauthorized access'})
}

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
    const paymentCollection = db.collection('payment');
    const userCollection = db.collection('users');
    const raiderCollection = db.collection('raiders');
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
    query.customerEmail = email;
      // check valid email address
  if(email !== req.decoded_email){
    return res.status(403).send({message : 'forbidden access'})
  }
  }

  const curser = paymentCollection.find(query).sort({paidAt: -1});
  const result = await curser.toArray();
  res.send(result)
})
// post for sending user in database
app.post('/users', async(req,res)=>{
  const user = req.body
  const email = user.email
  user.role = 'user'
  user.CreateAt = new Date()
  const userExist = await userCollection.findOne({email})
  if(userExist){
    return res.send({message : 'user already exist'})
  }
  const result = await userCollection.insertOne(user)
  res.send(result);

})
// raider collection data send in database
app.post('/raiders', async(req,res)=>{
  const raider = req.body;
  raider.status = 'painding';
  raider.CreateAt = new Date();
  const result = await raiderCollection.insertOne(raider)
  res.send(result);
})
// get raider data in api 
app.get('/raiders', async(req,res)=>{
  const query = {}
  if(req.query.status){
    query.status = req.query.status
  }
  const cursor = raiderCollection.find(query)
  const result = await cursor.toArray()
  res.send(result)
})
//update status in a raider
app.patch('/raiders/:id', verifyToken, async(req,res)=>{
  const status = req.body.status
  const id = req.params.id;
  const query = { _id : new ObjectId(id)}
  const updateDoc = {
    $set:{
      status:status
    }
    
  }
  const result = await raiderCollection.updateOne(query , updateDoc);
  //update user role , user to raider
  if(status === 'approved'){
    const email = req.body.email
    const userQuery = {email}
    const updateUser = {
      $set:{
        role: 'Raider'
      }
    }
    const result = await userCollection.updateOne(userQuery, updateUser)
    res.send(result)
  }
  res.send(result);
})
    // Delete a raider in database
    app.delete('/raiders/:id', async(req,res) =>{
      const id = req.params.id;
      const query = { _id: new ObjectId(id)}
      const result = await raiderCollection.deleteOne(query)
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