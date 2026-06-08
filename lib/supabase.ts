import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
// Check both possible environment variable names
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || '';

// Improved check to handle string "undefined" which can happen in some build/deploy environments
const isValid = (val: string) => val && val !== 'undefined' && val !== 'null' && val.trim() !== '';

if (!isValid(supabaseUrl) || !isValid(supabaseAnonKey)) {
  console.error('CRITICAL: Missing or invalid Supabase environment variables. URL:', supabaseUrl, 'Key:', supabaseAnonKey ? '[SET]' : '[MISSING]');
}

// Create client only if keys are valid
export const supabase = (isValid(supabaseUrl) && isValid(supabaseAnonKey)) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : (null as any);
