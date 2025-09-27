  const reload = async () => {
    setLoading(true);
    setErr('');
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('attendance')
        .select('id,timestamp,staff_name,staff_email,action,distance_m,lat,lon')
        .gte('timestamp', start.toISOString())
        .order('timestamp', { ascending: true });

      if (error) {
        throw new Error(error.message);   // 🔴 instead of "throw error"
      }

      setRows((data ?? []) as Row[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };