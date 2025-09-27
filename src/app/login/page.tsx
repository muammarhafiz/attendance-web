'use client';
import { supabase } from '@/lib/supabaseClient';

const CALLBACK_URL = 'https://attendancezp-web.vercel.app/auth/callback';

export default function Login() {
  const signInGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: CALLBACK_URL },
    });
  };

  return (
    <main style={{padding:16,fontFamily:'system-ui'}}>
      <h2>Sign in</h2>
      <p>Only allow-listed staff can access.</p>
      <button onClick={signInGoogle} style={{padding:10,border:'1px solid #ccc',borderRadius:8}}>
        Continue with Google
      </button>
    </main>
  );
}