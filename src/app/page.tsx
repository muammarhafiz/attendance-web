// Auth handling: explicitly exchange OAuth params on the home page,
// then read the session. No redirects here.
useEffect(() => {
  let cancelled = false;

  const hasOAuthParams =
    typeof window !== 'undefined' &&
    (window.location.search.includes('code=') ||
     window.location.hash.includes('access_token='));

  const init = async () => {
    try {
      // 1) If we were redirected here with params, exchange them for a session
      if (hasOAuthParams) {
        await supabase.auth.exchangeCodeForSession(window.location.href).catch(() => {
          // ignore — we’ll still try to read a session below
        });
        // Clean the URL (remove ?code=... or #access_token=...)
        try {
          const url = new URL(window.location.href);
          url.search = '';
          url.hash = '';
          window.history.replaceState({}, '', url.toString());
        } catch {}
      }

      // 2) Read current session
      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setSessionEmail(data.session?.user?.email ?? null);
        setChecking(false);
      }
    } catch {
      if (!cancelled) setChecking(false);
    }
  };

  // Also subscribe to auth changes
  const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
    if (!cancelled) setSessionEmail(session?.user?.email ?? null);
  });

  init();

  return () => { cancelled = true; sub.subscription.unsubscribe(); };
}, []);