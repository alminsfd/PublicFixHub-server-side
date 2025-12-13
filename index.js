const express = require('express')
const cors = require('cors');
const crypto = require("crypto");
require('dotenv').config()
const app = express()
const port = process.env.PORT || 5000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
//middaleware
app.use(express.json());
app.use(cors());

const admin = require("firebase-admin");

const serviceAccount = require("./reporting-system-69-firebase-adminsdk.json");
const e = require('express');
const { log } = require('console');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


//FbToken
const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access' })
  }


}

//admin vafify token 
const verifyAdmin = async (req, res, next) => {
  const email = req.decoded_email;
  const query = { email };
  const user = await userCollection.findOne(query);

  if (!user || user.role !== 'admin') {
    return res.status(403).send({ message: 'forbidden access' });
  }

  next();
}

//staff
const verifystaff = async (req, res, next) => {
  const email = req.decoded_email;
  const query = { email };
  const user = await userCollection.findOne(query);

  if (!user || user.role !== 'staff') {
    return res.status(403).send({ message: 'forbidden access' });
  }

  next();
}


//trakerNumber
function generateTrackingId() {
  const prefix = "PFHI";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `${prefix}-${date}-${random}`;
}



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.eepqhhq.mongodb.net/?appName=Cluster0`;

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
    await client.connect();

    //database and collection
    const db = client.db('publicfixhub')
    const userCollection = db.collection('users')
    const IssuesCollection = db.collection('issues')
    const trackingsCollection = db.collection('tracking')
    const paymentCollection = db.collection('payments')

    //issueConunt api
    app.get("/issues/count/:userId", async (req, res) => {
      const userId = req.params.userId;
      const count = await IssuesCollection.countDocuments({ createdBy: userId });
      res.send({ count });
    });
    //timelinFuntionality
    const logTracking = async (trackingId, status, userId, role, message) => {
      const log = {
        trackingId,
        status,
        updatedBy: userId,
        role: role,
        message,
        createdAt: new Date()
      }
      const result = await trackingsCollection.insertOne(log);
      return result;
    }

    //userapi

    app.post('/users', async (req, res) => {
      const user = req.body
      user.role = 'citizen';
      user.isPremium = false;
      user.isBlocked = false;
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email })
      if (userExists) {
        return res.send({ message: 'user exists' })
      }
      const result = await userCollection.insertOne(user);
      res.send(result);

    })

    // get user api

    app.get('/users', verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {}
      if (email) {
        query.email = email
        if (req.decoded_email !== email) {
          return res.status(403).send({ message: 'forbidden access' })
        }
      }
      const cursor = await userCollection.find(query).toArray();
      res.send(cursor);
    })

    //update user info

    app.patch('/users/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body;
        console.log(id, updateData)
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            displayName: updateData.displayName,
            email: updateData.email,
            photoURL: updateData.photoURL,
            updatedAt: new Date()
          }
        };

        const result = await userCollection.updateOne(filter, updateDoc);

        res.send(result);

      } catch (error) {
        console.log("Update Issue Error:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    //Issues api
    app.post('/issues', async (req, res) => {
      const Issueinfo = req.body;
      const trackingId = generateTrackingId();
      // parcel created time
      Issueinfo.createdAt = new Date();
      Issueinfo.trackingId = trackingId;
      Issueinfo.priority = 'normal'
      Issueinfo.assignedStaff = 'N/A',
        Issueinfo.status = 'pending',
        Issueinfo.upvotes = 0
      logTracking(trackingId, 'pending', Issueinfo.createdBy, Issueinfo.role, `Issue reported by ${Issueinfo.name}`);
      const result = await IssuesCollection.insertOne(Issueinfo);
      res.send(result)
    })

    //get all issue api
    app.get("/issues", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {}
      if (email) {
        query.createrEmail = email
        if (req.decoded_email !== email) {
          return res.status(403).send({ message: 'forbidden access' })
        }
      }
      const cursor = await IssuesCollection.find(query).toArray();
      res.send(cursor);
    });
    //issue details API
    app.get("/issues/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const cursor = await IssuesCollection.find(query).toArray();
      res.send(cursor);
    });
    //issue delete
    app.delete("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const cursor = await IssuesCollection.deleteOne(query)
      res.send(cursor);
    });
    //issue update api

    app.patch('/issues/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            title: updateData.title,
            catagory: updateData.catagory,
            description: updateData.description,
            photoURL: updateData.photoURL,
            location: updateData.location,
            updatedAt: new Date()
          }
        };

        const result = await IssuesCollection.updateOne(filter, updateDoc);

        res.send(result);

      } catch (error) {
        console.log("Update Issue Error:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    //payment api

    app.post('/payment-checkout-session', async (req, res) => {
      const parcelInfo = req.body;
      const amount = parseInt(parcelInfo.price) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: {
                name: `Please pay for: ${parcelInfo.Name}`
              }
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        metadata: {
          userId: parcelInfo.userId,
          email: parcelInfo.email
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      })

      res.send({ url: session.url })
    })

    //payment successful api

    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId }

      const paymentExist = await paymentCollection.findOne(query);
      if (paymentExist) {
        return res.send({
          message: 'already exists',
          transactionId,
          trackingId: paymentExist.userId
        })
      }
      const trackingId = session.metadata.userId;

      if (session.payment_status === 'paid') {
        const id = session.metadata.userId;
        const query = { _id: new ObjectId(id) }
        const update = {
          $set: {
            isPremium:true
          }
        }

        const result = await userCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          userEmail: session.email,
          userId: session.metadata.userId,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId
        }
        const resultPayment = await paymentCollection.insertOne(payment);
        return res.send({
          success: true,
          modifyParcel: result,
          trackingId: trackingId,
          transactionId: session.payment_intent,
          paymentInfo: resultPayment
        })
      }
      return res.send({ success: false })
    })

    //role Api
    app.get('/users/:email/role', verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const query = { email }
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || 'user' })
    })

    //userId api

    app.get('/users/:email/id', verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const query = { email }
      const user = await userCollection.findOne(query);
      res.send({
        id: user?._id,
        name: user?.displayName,
        isPremium: user?.isPremium,
        email: user?.email
      })
    })


    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    //as need your
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('reporting-server-starting')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
