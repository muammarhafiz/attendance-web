'use client';
import { supabase } from '@/lib/supabaseClient';

const CALLBACK_URL = 'https://attendancezp-web.vercel.app/auth/callback';

export default function Login() {
  const google = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: CALLBACK_URL,   // come back to our domain
        flowType: 'pkce',           // explicit PKCE
        queryParams: { prompt: 'consent' } // avoids cached sessions confusing Safari
      }
    });
  };

  const magic = async () => {
    const email = prompt('Email?');
    if (!email) return;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: CALLBACK_URL }
    });
    alert(error ? error.message : 'Magic link sent.');
  };

  return (
    <main style={{padding:16,fontFamily:'system-ui'}}>
      <h2>Sign in</h2>
      <button onClick={google} style={{padding:10,border:'1px solid #ccc',borderRadius:8}}>
        Continue with Google
      </button>
      <div style={{height:10}}/>
      <button onClick={magic} style={{padding:10,border:'1px solid #ccc',borderRadius:8}}>
        Send magic link to my email
      </button>
    </main>
  );
}