const express = require('express')
const cors = require('cors');
require('dotenv').config()
const app = express()
const port = process.env.PORT || 5000
const { MongoClient, ServerApiVersion } = require('mongodb');
//middaleware
app.use(express.json());
app.use(cors());

const admin = require("firebase-admin");

const serviceAccount = require("./reporting-system-69-firebase-adminsdk.json");

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
    console.log('decoded in the token', decoded);
    req.decoded_email = decoded.email;
    next();
  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access' })
  }


}
//user varify
const verifyuser = async (req, res, next) => {
  const email = req.decoded_email;
  const query = { email };
  const user = await userCollection.findOne(query);

  if (!user || user.role !== 'citizen') {
    return res.status(403).send({ message: 'forbidden access' });
  }

  next();
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
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

  return `${prefix}-${date}-${random}`;
}

//timelinFuntionality

const logTracking = async (trackingId, status) => {
  const log = {
    trackingId,
    status,
    details: status.split('_').join(' '),
    createdAt: new Date()
  }
  const result = await trackingsCollection.insertOne(log);
  return result;
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

      //Issues api
      app.post('/issues', async (req, res) => {
        const Issueinfo = req.body;
        const trackingId = generateTrackingId();
        // parcel created time
        Issueinfo.createdAt = new Date();
        Issueinfo.trackingId = trackingId;
        Issueinfo.status = 'pending'
        Issueinfo.priority = 'normal'
        Issueinfo.assignedStaff = 'N/A'
        Issueinfo.upvotes = []
        // logTracking(trackingId, 'parcel_created');

        const result = await IssuesCollection.insertOne(Issueinfo);
        res.send(result)
      })

      //role Api
      app.get('/users/:email/role', verifyFBToken, async (req, res) => {
        const email = req.params.email;
        const query = { email }
        const user = await userCollection.findOne(query);
        res.send({ role: user?.role || 'user' })
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
