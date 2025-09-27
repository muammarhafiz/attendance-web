'use client';
import { supabase } from '@/lib/supabaseClient';

const APP_URL = 'https://attendancezp-web.vercel.app'; // <— hardcode

export default function Login() {
  const signInGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: APP_URL }, // back to "/"
    });
  };

  const signInMagic = async () => {
    const email = prompt('Email to send magic link to?');
    if (!email) return;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: APP_URL }, // MUST match Supabase "Site URL"
    });
    alert(error ? error.message : 'Magic link sent. Check your inbox.');
  };

  return (
    <main style={{padding:16,fontFamily:'system-ui'}}>
      <h2>Sign in</h2>
      <p>Only allow-listed staff can access.</p>
      <button onClick={signInGoogle} style={{padding:10,border:'1px solid #ccc',borderRadius:8}}>Continue with Google</button>
      <div style={{height:10}} />
      <button onClick={signInMagic} style={{padding:10,border:'1px solid #ccc',borderRadius:8}}>Send magic link to my email</button>
    </main>
  );
}