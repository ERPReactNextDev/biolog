import { MongoClient } from "mongodb";
import bcrypt from "bcrypt";

/* ============================================================
   ENV CHECK
   ============================================================ */
if (!process.env.MONGODB_URI) {
  throw new Error("Please define the MONGODB_URI environment variable");
}

const uri = process.env.MONGODB_URI;

/* ============================================================
   CONNECTION (singleton pattern)
   ============================================================ */
let client: MongoClient;
let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  // Reuse connection across hot-reloads in dev
  if (!global._mongoClient) {
    global._mongoClient = new MongoClient(uri);
  }
  client = global._mongoClient;
  clientPromise = client.connect();
} else {
  client = new MongoClient(uri);
  clientPromise = client.connect();
}

export default clientPromise;

/* ============================================================
   connectToDatabase
   ============================================================ */
export async function connectToDatabase() {
  const client = await clientPromise;
  return client.db("ecoshift");
}

/* ============================================================
   SUPER ADMIN SEED  (runs once automatically)
   – Checks the "users" collection on first connect.
   – Creates the Super Admin only if neither the email
     nor the ReferenceID already exists.
   ============================================================ */

/** Called internally – not exported on purpose so it can't be
 *  triggered from outside this module. */
async function seedSuperAdmin() {
  try {
    const db = await connectToDatabase();
    const users = db.collection("users");

    const SUPER_ADMIN = {
      Email:       "superadmin@biolog.com",
      Password:    "pass",           // ← plain-text; gets hashed below
      Role:        "SuperAdmin",
      Department:  "IT",
      Firstname:   "Super",
      Lastname:    "Admin",
      ReferenceID: "ADMIN-001",
      Status:      "Active",
      LoginAttempts: 0,
      Connection:  "Offline",
      pin:         "123456",
    } as const;

    // Skip if Super Admin already exists (by email OR referenceID)
    const exists = await users.findOne({
      $or: [
        { Email:       SUPER_ADMIN.Email },
        { ReferenceID: SUPER_ADMIN.ReferenceID },
      ],
    });

    if (exists) {
      return;
    }

    const hashedPassword = await bcrypt.hash(SUPER_ADMIN.Password, 10);

    await users.insertOne({
      ...SUPER_ADMIN,
      Password:  hashedPassword,
      createdAt: new Date(),
    });

  } catch (err) {
    // Non-fatal: log the error but don't crash the app
  }
}

// Fire-and-forget – runs as soon as this module is first imported.
// Because clientPromise is a singleton, this only runs once per
// process lifetime (not once per request).
seedSuperAdmin();

/* ============================================================
   registerUser
   ============================================================ */
export async function registerUser({
  Email,
  Password,
  Role,
  Firstname,
  Lastname,
  ReferenceID,
}: {
  Email:       string;
  Password:    string;
  Role:        string;
  Firstname:   string;
  Lastname:    string;
  ReferenceID: string;
}) {
  const db    = await connectToDatabase();
  const users = db.collection("users");

  const existingUser = await users.findOne({ Email });
  if (existingUser) {
    return { success: false, message: "Email already in use" };
  }

  const hashedPassword = await bcrypt.hash(Password, 10);

  await users.insertOne({
    Email,
    Role,
    Firstname,
    Lastname,
    ReferenceID,
    Password:  hashedPassword,
    createdAt: new Date(),
  });

  return { success: true };
}

/* ============================================================
   validateUser
   ============================================================ */
export async function validateUser({
  Email,
  Password,
}: {
  Email:    string;
  Password: string;
}) {
  const db    = await connectToDatabase();
  const users = db.collection("users");

  // Match primary Email OR SecondaryEmail (case-insensitive)
  const user = await users.findOne({
    $or: [
      { Email:          { $regex: new RegExp(`^${Email}$`, "i") } },
      { SecondaryEmail: { $regex: new RegExp(`^${Email}$`, "i") } },
    ],
  });

  if (!user) {
    return { success: false, message: "Invalid email or password" };
  }

  const isValid = await bcrypt.compare(Password, user.Password);
  if (!isValid) {
    return { success: false, message: "Invalid email or password" };
  }

  return { success: true, user };
}