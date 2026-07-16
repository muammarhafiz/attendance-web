'use client';

// Full-screen phone-camera barcode scanner. Uses the native BarcodeDetector API when it
// really supports Code 128 (Android Chrome) and lazily falls back to a WASM ponyfill
// (barcode-detector, ZXing-C++) on iOS Safari / Firefox — one code path for both.
import { useCallback, useEffect, useRef, useState } from 'react';

type Detected = { rawValue: string };
type DetectorLike = { detect(src: CanvasImageSource): Promise<Detected[]> };
type BDCtor = {
  new (opts?: { formats?: string[] }): DetectorLike;
  getSupportedFormats?(): Promise<string[]>;
};

// 1D formats found on auto-parts boxes (Code 128 is the Proton/OEM one; keep a few EAN/UPC too).
const FORMATS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'codabar', 'itf'];

async function makeDetector(): Promise<DetectorLike> {
  const Native = (globalThis as unknown as { BarcodeDetector?: BDCtor }).BarcodeDetector;
  if (Native) {
    try {
      const supported = (await Native.getSupportedFormats?.()) ?? [];
      if (supported.includes('code_128')) return new Native({ formats: FORMATS });
    } catch {
      /* some browsers expose the constructor but throw — fall back to the ponyfill */
    }
  }
  const mod = await import('barcode-detector/ponyfill');
  const Ponyfill = (mod as unknown as { BarcodeDetector: BDCtor }).BarcodeDetector;
  return new Ponyfill({ formats: FORMATS });
}

export default function BarcodeScanner({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  // Keep the latest onDetected without restarting the camera when the parent re-renders.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const [error, setError] = useState<string | null>(null);
  const [torchable, setTorchable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser can’t open the camera here. Try Chrome, or type the code by hand.');
        return;
      }
      try {
        const detector = await makeDetector();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();

        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorchable(Boolean(caps.torch));

        let busy = false;
        const tick = async () => {
          if (!streamRef.current) return;
          if (!busy && video.readyState >= 2) {
            busy = true;
            try {
              const codes = await detector.detect(video);
              const value = codes[0]?.rawValue?.trim();
              if (value) {
                stop();
                onDetectedRef.current(value);
                return;
              }
            } catch {
              /* transient per-frame decode error — keep scanning */
            }
            busy = false;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        const name = (e as { name?: string })?.name;
        if (name === 'NotAllowedError') setError('Camera permission was denied. Allow camera access, then try again.');
        else if (name === 'NotFoundError') setError('No camera found on this device.');
        else if (name === 'NotReadableError') setError('The camera is being used by another app. Close it and retry.');
        else setError((e as Error)?.message ?? 'Could not start the camera.');
      }
    })();
    return () => {
      active = false;
      stop();
    };
  }, [stop]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] } as unknown as MediaTrackConstraints);
      setTorchOn((v) => !v);
    } catch {
      /* torch not actually applicable on this device — ignore */
    }
  }, [torchOn]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm font-medium">Scan the part’s barcode</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-white/15 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/25"
        >
          Cancel
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        {!error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-28 w-72 max-w-[80%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm rounded-lg bg-white p-4 text-center text-sm text-gray-700">{error}</div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 px-4 py-3 text-white/80">
        {torchable && (
          <button
            type="button"
            onClick={toggleTorch}
            className="rounded-md bg-white/15 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/25"
          >
            {torchOn ? '🔦 Torch off' : '🔦 Torch on'}
          </button>
        )}
        <span className="text-xs">Point the rear camera at the barcode</span>
      </div>
    </div>
  );
}
