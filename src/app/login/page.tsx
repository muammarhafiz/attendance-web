'use client';
import { supabase } from '@/lib/supabaseClient';

export default function Login() {
  const signInGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/api/auth/callback` } // back to /
    });
  };

  return (
    <main style={{padding:16,fontFamily:'system-ui'}}>
      <h2>Sign in</h2>
      <p>Only allow-listed staff can access.</p>
      <button 
        onClick={signInGoogle} 
        style={{
          padding:10,
          border:'1px solid #ccc',
          borderRadius:8,
          cursor:'pointer'
        }}
      >
        Continue with Google
      </button>
    </main>
  );
}