const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const path = require('path');

// Load .env.local
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase environment variables are not defined in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createSuperAdmin() {
  try {
    const email = 'superadmin@biolog.com';
    const password = 'pass';
    const role = 'Super Admin';
    const department = 'IT';
    const firstname = 'Super';
    const lastname = 'Admin';
    const referenceID = 'ADMIN-001';

    // Check if the admin already exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .or(`Email.eq.${email},ReferenceID.eq.${referenceID}`)
      .maybeSingle();

    if (fetchError) throw fetchError;

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
      createdAt: new Date().toISOString(),
      LoginAttempts: 0,
      Connection: 'Offline',
      pin: '123456' // Default pin
    };

    const { error: insertError } = await supabase.from('users').insert(newUser);
    if (insertError) throw insertError;

    console.log('Super Admin account successfully created!');
    console.log('Email:', email);
    console.log('Password:', password);
  } catch (error) {
    console.error('Error creating super admin:', error);
  }
}

createSuperAdmin();
