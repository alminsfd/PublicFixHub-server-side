const express = require('express')
const cors = require('cors');
const crypto = require("crypto");
require('dotenv').config()
const app = express()
const port = process.env.PORT || 5000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
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
    return res.status(401).send({ message: 'unauthorized access 1' })
  }
  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    req.user = {
      email: decoded.email
    };
    next();
  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access 2' })
  }


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
    // await client.connect();

    //database and collection
    const db = client.db('publicfixhub')
    const userCollection = db.collection('users')
    const IssuesCollection = db.collection('issues')
    const trackingsCollection = db.collection('tracking')
    const paymentCollection = db.collection('payments')


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


    //blocken
    const checkBlockedUser = async (req, res, next) => {
      const email = req.user.email;

      const user = await userCollection.findOne({ email });

      if (user?.isBlocked) {
        return res.status(403).json({
          message: "You are blocked. Action not allowed."
        });
      }

      next();
    };

    //issueConunt api
    app.get("/issues/count/:userId", async (req, res) => {
      const userId = req.params.userId;
      const count = await IssuesCollection.countDocuments({ createdBy: userId });
      res.send({ count });
    });
    //issuehomeDashboardcount
    app.get("/issues/user/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const query = { createrEmail: email };

        const issues = await IssuesCollection.find(query).sort({ createdAt: -1 }).toArray();

        res.send(issues);
      } catch (error) {
        console.error("Error fetching user issues:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    //userPaymentcount
    app.get("/userpayment/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }
        const query = { customerEmail: email };
        const issuespay = await paymentCollection.find(query).sort({ paidAt: -1 }).toArray();
        res.send(issuespay);
      } catch (error) {
        console.error("Error fetching user issues:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    //timelinFuntionality
    const logTracking = async (trackingId, status, role, message) => {
      const log = {
        trackingId,
        status,
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

    //Lates Issue api

    app.get('/issues/resolved/latest', async (req, res) => {
      const result = await IssuesCollection
        .find({ status: "resolved" })
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();

      res.send(result);
    });



    //Issues api
    app.post('/issues', verifyFBToken, checkBlockedUser, async (req, res) => {
      const trackingId = generateTrackingId();
      const Issueinfo = req.body;
      // parcel created time
      Issueinfo.createdAt = new Date();
      Issueinfo.trackingId = trackingId;
      Issueinfo.priority = 'normal'
      Issueinfo.assignedStaff = 'N/A',
        Issueinfo.status = 'pending',
        Issueinfo.upvotes = 0,
        Issueinfo.upvotedBy = []
      logTracking(trackingId, 'pending', Issueinfo.role, `Issue reported by ${Issueinfo.name}`);
      console.log(Issueinfo)
      const result = await IssuesCollection.insertOne(Issueinfo);
      res.send(result)
    })

    // Issue upovetes increate
    app.patch("/issues/upvote/:id", verifyFBToken, checkBlockedUser, async (req, res) => {
      const id = req.params.id;
      const { email, createrEmail } = req.body;
      if (!email) {
        return res.status(400).send({ message: "Log in first" });
      }
      if (createrEmail === email) {
        return res.status(400).send({ message: "You can't upvote your own issue" });
      }

      const result = await IssuesCollection.updateOne(
        {
          _id: new ObjectId(id),
          upvotedBy: { $ne: email }
        },
        {
          $inc: { upvotes: 1 },
          $addToSet: { upvotedBy: email }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(400).send({ message: "Already upvoted" });
      }

      res.send({
        success: true,
        message: "Upvoted successfully"
      });
    });

    /*** -----------------------------------  Admin--------------------     */
    //get all issue by  status

    app.get('/issues/status', verifyFBToken, verifyAdmin, async (req, res) => {

      const cursor = await IssuesCollection.find({}).toArray()
      res.send(cursor)

    })

    app.get('/staff', verifyFBToken, verifyAdmin, async (req, res) => {
      const cursor = await userCollection.find({ role: 'staff' }).toArray()
      res.send(cursor)
    })


    app.patch("/issues/assign/:id", verifyFBToken, verifyAdmin, async (req, res) => {

      const id = req.params.id;
      const { staff } = req.body;


      const issue = await IssuesCollection.findOne({ _id: new ObjectId(id) });


      if (issue.assignedStaff !== "N/A") {
        return res.send({ message: "Already assigned" });
      }


      logTracking(staff.trackingId, 'pending', 'admin', `Issue assigned to Staff: ${staff.name}`)


      const result = await IssuesCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            assignedStaff: staff,
          }
        }
      );

      res.send(result);
    });


    app.patch("/issues/reject/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const trackingIdsame = req.body.trackingId

      const result = await IssuesCollection.updateOne(
        { _id: new ObjectId(id), status: "pending" },
        { $set: { status: "rejected" } }
      );

      logTracking(trackingIdsame, 'rejected', 'admin', `Issue is rejected by admin`)

      res.send(result);
    });

    // GET /users/citizens
    app.get('/users/citizens', verifyFBToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find({ role: 'citizen' }).toArray();
      res.send(result);
    });
    //get all staffs
    app.get('/users/staffs', verifyFBToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find({ role: 'staff' }).toArray();
      res.send(result);
    });

    //staff delete
    app.delete('/users/:id/delete', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await userCollection.deleteOne(query)
      res.send(result);
    });

    // GET /payments/user/:email
    app.get('/payments/user/:email', verifyFBToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const payment = await paymentCollection.findOne({
        customerEmail: email,
        paymentStatus: 'paid',
        paymentType: 'premium'
      });
      res.send(payment);
    });

    // PATCH /users/block/:id
    app.patch('/users/block/:id', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { isBlocked } = req.body;

      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isBlocked } }
      );

      res.send(result);
    });
    //get admin 
    app.get('/users/admin', verifyFBToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find({ role: "admin" }).toArray()
      res.send(result)
    })

    // GET /payments?type=premium
    app.get('/payments', verifyFBToken, verifyAdmin, async (req, res) => {
      const type = req.query.type;

      let query = {};
      if (type) {
        query.paymentType = type;
      }

      const payments = await paymentCollection
        .find(query)
        .sort({ paidAt: -1 })
        .toArray();

      res.send(payments);
    });


    app.post('/users/create-staff', verifyFBToken, verifyAdmin, async (req, res) => {
      const { email, password, displayName, phone, photoURL } = req.body;

      try {
        // 1️ Firebase Auth user create
        const userRecord = await admin.auth().createUser({
          email,
          password,
          displayName,
          photoURL,
        });

        // 2️ Database save
        const staffData = {
          uid: userRecord.uid,
          email,
          displayName,
          phone,
          photoURL,
          role: "staff",
          isBlocked: false,
          createdAt: new Date()
        };

        const result = await userCollection.insertOne(staffData);

        res.send(result);

      } catch (error) {
        res.status(400).send({ message: error.message });
      }
    });


    //admin Homedashboard

    app.get('/dashboard/issues-stats', verifyFBToken, verifyAdmin, async (req, res) => {
      const total = await IssuesCollection.countDocuments();

      const resolved = await IssuesCollection.countDocuments({ status: 'resolved' });
      const pending = await IssuesCollection.countDocuments({ status: 'pending' });
      const rejected = await IssuesCollection.countDocuments({ status: 'rejected' });

      res.send({
        total,
        resolved,
        pending,
        rejected
      });
    });


    //latest issue

    app.get('/dashboard/latest-issues', async (req, res) => {
      const result = await IssuesCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      res.send(result);
    });


    //some latest payments'

    app.get('/dashboard/latest-payments', async (req, res) => {
      const result = await paymentCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      res.send(result);
    });


    //some latest users

    app.get('/dashboard/latest-users', async (req, res) => {
      const result = await userCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      res.send(result);
    });

    //total payments receive

    app.get('/dashboard/payment-stats', verifyFBToken, async (req, res) => {
      const payments = await paymentCollection.find().toArray();

      const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);

      res.send({
        totalPayments: payments.length,
        totalAmount
      });
    });


    /** -------------------------------------------------------------------------- */







    /**  --------------- Staff -------------------------------------------------- */


    app.get("/issues/staff/:email", verifyFBToken, verifystaff, async (req, res) => {
      const email = req.params.email;

      const issues = await IssuesCollection.find({
        "assignedStaff.email": email,
        status: { $ne: "rejected" }
      }).toArray();

      res.send(issues);
    });

    app.get('/users/saff', verifyFBToken, verifystaff, async (req, res) => {
      const email = req.query.email;
      const query = {}
      if (email) {
        query.email = email
        if (req.decoded_email !== email) {
          return res.status(403).send({ message: 'forbidden access' })
        }
      }
      const cursor = await userCollection.find(query, { role: "staff" }).toArray();
      res.send(cursor);
    })

    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;

      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      res.send(user);
    });

    app.patch('/issues/:id/status', verifyFBToken, verifystaff, async (req, res) => {
      const id = req.params.id;
      const { status, trackingId } = req.body;


      const statusMessages = {
        "in-progress": "Work started on the issue",
        "working": "Work started on the issue",
        "resolved": "Issue marked as resolved",
        "closed": "Issue closed by staff"
      };
      const message = statusMessages[status] || `Status changed to ${status}`;

      const result = await IssuesCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: { status },
        }
      );

      if (result.modifiedCount > 0) {
        await logTracking(trackingId, status, 'staff', message);
      }

      res.send(result);
    });

    //StaffdashboardHome
    app.get('/dashboard/staff/:email', verifyFBToken, verifystaff, async (req, res) => {
      const email = req.params.email;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      console.log(today)


      const assigned = await IssuesCollection.countDocuments({
        'assignedStaff.email': email,
      });


      const resolved = await IssuesCollection.countDocuments({
        'assignedStaff.email': email,
        status: 'resolved'
      });


      const todayTasks = await IssuesCollection.countDocuments({
        'assignedStaff.email': email,
        createdAt: { $gte: today }
      });


      const statusStats = await IssuesCollection.aggregate([
        { $match: { 'assignedStaff.email': email } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]).toArray();


      res.send({ assigned, resolved, todayTasks, statusStats });
    });




    /**   ------------------------------------------------------------------------ */

    //get all issue
    app.get('/issues', async (req, res) => {
      let query = {}
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 6;
      const skip = (page - 1) * limit;
      const { status, priority, category, searchText } = req.query;
      if (searchText) {
        query.$or = [
          { title: { $regex: searchText, $options: 'i' } },
          { catagory: { $regex: searchText, $options: 'i' } },
          { location: { $regex: searchText, $options: 'i' } }
        ]

      }

      if (status) {
        query.status = status;
      }
      if (priority) {
        query.priority = priority;
      }
      if (category) {
        query.catagory = category;

      }
      const total = await IssuesCollection.countDocuments(query);
      const cursor = await IssuesCollection.find(query).skip(skip).limit(limit).toArray();
      res.send({
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        issues: cursor
      });
    })

    //get all issue api based on email
    app.get("/myissues", verifyFBToken, async (req, res) => {
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
      const query = { trackingId: id }
      const cursor = await IssuesCollection.findOne(query)
      res.send(cursor);
    });

    // GET issue timeline by trackingId
    app.get('/issue-timeline/:trackingId', async (req, res) => {
      const trackingId = req.params.trackingId;

      const result = await trackingsCollection
        .find({ trackingId })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    //issue delete
    app.delete("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const cursor = await IssuesCollection.deleteOne(query)
      res.send(cursor);
    });
    //issue update api

    app.patch('/issues/:id', verifyFBToken, checkBlockedUser, async (req, res) => {
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



    //bosting payment api

    app.post("/payment-checkout-session/boosting", verifyFBToken, checkBlockedUser, async (req, res) => {
      const IssueInfo = req.body
      const amount = parseInt(IssueInfo.price) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'bdt',
              unit_amount: amount,
              product_data: {
                name: `Please Boost for : ${IssueInfo.Issuetitle}`
              }
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        metadata: {
          Issueid: IssueInfo.Issueid,
          trackingId: IssueInfo.trackingId,
          Issuetitle: IssueInfo.Issuetitle

        },
        customer_email: IssueInfo.createrEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success-boosting?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled-boosting`,
      })
      res.send({ url: session.url })
    })




    //  suscribtion payment api payment api

    app.post('/payment-checkout-session', async (req, res) => {
      const parcelInfo = req.body;
      const amount = parseInt(parcelInfo.price) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'bdt',
              unit_amount: amount,
              product_data: {
                name: `Please pay : ${parcelInfo.Name}`
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

    //boosting successful api
    app.patch('/payment-success/boosting', async (req, res) => {

      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(session)
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId }
      const paymentExist = await paymentCollection.findOne(query);
      if (paymentExist) {
        return res.send({
          message: 'already exists',
          transactionId,
          trackingId: trackingId
        })
      }
      const trackingId = session.metadata.trackingId;
      if (session.payment_status === 'paid') {
        const id = session.metadata.Issueid;
        const query = { _id: new ObjectId(id) }
        const update = {
          $set: {
            priority: 'high',
          }
        }
        const result = await IssuesCollection.updateOne(query, update);
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          IssueId: session.metadata.Issueid,
          IssueName: session.metadata.Issuetitle,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paymentType: 'Boosting',
          paidAt: new Date(),
          trackingId: trackingId
        }
        const resultPayment = await paymentCollection.insertOne(payment);

        const trackingExist = await trackingsCollection.findOne({
          transactionId: session.payment_intent,
          Boosting: 'Boost the issue'
        });

        if (!trackingExist) {
          await trackingsCollection.insertOne({
            trackingId,
            transactionId: session.payment_intent,
            status: 'pending',
            Boosting: 'Boost the issue',
            updatedBy: session.metadata.Issueid,
            role: 'citizen',
            message: `Issue is Boosting by the citizen`,
            createdAt: new Date()
          });
        }


        return res.send({
          success: true,
          modifyParcel: result,
          trackingId: trackingId,
          transactionId: session.payment_intent,
          paymentInfo: resultPayment,
          trackingInfo: trackingId,
        })


      }

    })

    // suscribtion  payment successful api


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
            isPremium: true
          }
        }

        const result = await userCollection.updateOne(query, update);

        console.log(session)

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.metadata.email,
          userId: session.metadata.userId,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paymentType: 'premium',
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
