import { createClient } from '@supabase/supabase-js';

// We use import.meta.env because Vite requires it for security
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Check to make sure the keys are actually there (helpful for debugging)
if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Supabase URL or Anon Key is missing! Check your .env file.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);