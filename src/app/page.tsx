"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import dynamic from "next/dynamic";

const Map = dynamic(() => import("../../components/Map"), { ssr: false });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function HomePage() {
  const [workshop, setWorkshop] = useState<{ lat: number; lon: number; radius: number } | null>(null);
  const [position, setPosition] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  const [status, setStatus] = useState<string>("Waiting for location...");

  // Running clock
  const [clock, setClock] = useState<string>("");

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setClock(now.toLocaleString());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Get workshop data (hardcoded for now)
    setWorkshop({ lat: 2.687278, lon: 101.889442, radius: 120 });
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (pos) => {
          setPosition({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            acc: pos.coords.accuracy,
          });
        },
        () => setStatus("Unable to retrieve location"),
        { enableHighAccuracy: true }
      );
    } else {
      setStatus("Geolocation not supported");
    }
  }, []);

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold">Workshop Attendance</h2>
      <div className="text-gray-600">{clock}</div>

      {workshop && (
        <div>
          <p>
            Workshop: <b>{workshop.lat}, {workshop.lon}</b> • Radius:{" "}
            <b>{workshop.radius} m</b>
          </p>
        </div>
      )}

      <Map workshop={workshop} position={position} />

      <p>{status}</p>

      <div className="flex space-x-2">
        <button className="bg-green-500 text-white px-4 py-2 rounded">
          Check in
        </button>
        <button className="bg-blue-500 text-white px-4 py-2 rounded">
          Check out
        </button>
      </div>
    </div>
  );
}