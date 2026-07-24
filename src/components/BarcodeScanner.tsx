'use client';

// Full-screen phone-camera barcode scanner. Uses the native BarcodeDetector API when it
// really supports Code 128 (Android Chrome) and lazily falls back to a WASM ponyfill
// (barcode-detector, ZXing-C++) on iOS Safari / Firefox — one code path for both.
//
// Correctness rules — do not remove (see the "⊠7801#:773%,12" mis-decode, 2026-07-24):
//   1. a value must decode IDENTICALLY on N frames before it is emitted. Code 128's checksum
//      still lets ~1-in-103 corrupt reads through, and this loop makes hundreds of decode
//      attempts a second — so "first truthy read wins" made a bad read near-certain.
//   2. a value must pass looksLikeCode() before it can even start a streak.
//   3. more than one distinct valid code in view = refuse the frame, never guess codes[0].
//   4. detect() is given only the centre crop, not the whole frame (shelf labels sit adjacent).
import { useCallback, useEffect, useRef, useState } from 'react';

type Detected = { rawValue: string; format?: string };
type DetectorLike = { detect(src: CanvasImageSource): Promise<Detected[]> };
type BDCtor = {
  new (opts?: { formats?: string[] }): DetectorLike;
  getSupportedFormats?(): Promise<string[]>;
};

// Only the symbologies actually printed on the boxes we scan. codabar/itf carry no mandatory
// checksum, so each extra enabled format is another chance for the decoder to "successfully"
// read something that isn't there. Add one back only when a real label needs it.
const FORMATS = ['code_128', 'code_39', 'ean_13', 'upc_a'];

// Formats with a mandatory self-checking checksum need fewer confirming frames than those
// without. Code 39 (no required check digit, and extended/full-ASCII mode is on by default
// in ZXing — the source of the # : % , corruption) has to earn an extra frame.
const CHECKSUMMED = new Set(['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e']);
const framesNeeded = (fmt?: string) => (fmt && CHECKSUMMED.has(fmt) ? 2 : 3);

// Derived from the live catalog (niagawan_products.code, 11,246 non-blank rows).
//   present:  -  9992 | space 2175 | . 208 | / 199 | ( 83 | : 79 | ) 69 | + 6 | , 5 | & 4 | # 2
//   ZERO occurrences:  %   $   *   and zero non-ASCII characters.
// A Code 39 extended-mode mis-decode emits exactly those (/E->'%', /D->'$', /J->'*'), so this
// rejects the corruption while accepting every real code. Note # : , ARE legitimate
// (PWS:PW850573, FP:17045-SWA-A01) — never reject them.
const BAD_CHARS = /[^\x20-\x7E]|[%$*]/;
export const looksLikeCode = (s: string) => s.length >= 2 && s.length <= 32 && !BAD_CHARS.test(s);

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  // The value we've seen so far and how many frames agreed on it.
  const streakRef = useRef<{ value: string; format?: string; count: number } | null>(null);
  // Keep the latest onDetected without restarting the camera when the parent re-renders.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const [error, setError] = useState<string | null>(null);
  const [torchable, setTorchable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [hint, setHint] = useState('Point the rear camera at the barcode');

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

        // Crop the frame down to a generous centre band before decoding: it keeps neighbouring
        // shelf labels out of the picture and, because it's ~a quarter of the pixels, it decodes
        // faster than the full frame — which pays for the extra confirming frame above.
        const cropFrame = (): CanvasImageSource | null => {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (!vw || !vh) return null;
          const sw = Math.round(vw * 0.8);
          const sh = Math.round(vh * 0.45);
          const sx = Math.round((vw - sw) / 2);
          const sy = Math.round((vh - sh) / 2);
          let canvas = canvasRef.current;
          if (!canvas) {
            canvas = document.createElement('canvas');
            canvasRef.current = canvas;
          }
          if (canvas.width !== sw || canvas.height !== sh) {
            canvas.width = sw;
            canvas.height = sh;
          }
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return null;
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
          return canvas;
        };

        const tick = async () => {
          if (!streamRef.current) return;
          if (video.readyState >= 2) {
            try {
              const src = cropFrame();
              const codes = src ? await detector.detect(src) : [];
              if (!streamRef.current) return; // stopped while we awaited
              // Keep only plausible values, then require exactly ONE distinct candidate —
              // two different codes in view means we cannot know which one was aimed at.
              const good = codes.filter((c) => looksLikeCode((c.rawValue ?? '').trim().toUpperCase()));
              const distinct = [...new Set(good.map((c) => c.rawValue.trim().toUpperCase()))];

              if (codes.length && !good.length) {
                // Something decoded but it was garbage — never let it start a streak. Show the
                // rejected value + which symbology produced it: a label that fails EVERY time is
                // usually one format winning over the right one, and this names the culprit.
                streakRef.current = null;
                const bad = (codes[0]?.rawValue ?? '').trim().slice(0, 24);
                setHint(`Bad read (${codes[0]?.format ?? 'unknown'}): ${bad} — ignored, keep aiming`);
              } else if (distinct.length > 1) {
                streakRef.current = null;
                setHint('More than one barcode in view — move closer to just one');
              } else if (distinct.length === 1) {
                const value = distinct[0];
                const format = good[0]?.format;
                const cur = streakRef.current;
                streakRef.current =
                  cur && cur.value === value
                    ? { value, format: cur.format ?? format, count: cur.count + 1 }
                    : { value, format, count: 1 };
                const need = framesNeeded(streakRef.current.format);
                if (streakRef.current.count >= need) {
                  stop();
                  onDetectedRef.current(value);
                  return;
                }
                setHint('Hold steady…');
              }
              // a frame with no barcode at all leaves the streak alone (brief blur is normal)
            } catch {
              /* transient per-frame decode error — keep scanning */
            }
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
        <span className="text-xs">{hint}</span>
      </div>
    </div>
  );
}
