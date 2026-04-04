const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const path = require('path');

// Load .env.local
dotenv.config({ path: path.join(__dirname, '.env.local') });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not defined in .env.local');
  process.exit(1);
}

const client = new MongoClient(uri);

async function createSuperAdmin() {
  try {
    await client.connect();
    const db = client.db('biolog');
    const usersCollection = db.collection('users');

    const email = 'superadmin@biolog.com';
    const password = 'pass';
    const role = 'Super Admin';
    const department = 'IT';
    const firstname = 'Super';
    const lastname = 'Admin';
    const referenceID = 'ADMIN-001';

    // Check if the admin already exists
    const existingUser = await usersCollection.findOne({ 
      $or: [{ Email: email }, { ReferenceID: referenceID }] 
    });

    if (existingUser) {
      console.log('Super Admin na account ay exist na.');
      process.exit(0);
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      Email: email,
      Password: hashedPassword,
      Role: role,
      Department: department,
      Firstname: firstname,
      Lastname: lastname,
      ReferenceID: referenceID,
      Status: 'Active',
      createdAt: new Date(),
      LoginAttempts: 0,
      Connection: 'Offline',
      pin: '123456' // Default pin
    };

    await usersCollection.insertOne(newUser);
    console.log('Super Admin account successfully created!');
    console.log('Email:', email);
    console.log('Password:', password);
  } catch (error) {
    console.error('Error creating super admin:', error);
  } finally {
    await client.close();
  }
}

createSuperAdmin();
