import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { Camera, CameraOff, KeyRound, Lock, ScanLine, ShieldCheck, UserX } from "lucide-react";
import { Alert, Button, Input, Logo } from "@/components/ui";

/** Accepts a full verification URL or a bare token. */
export function extractToken(raw: string): string | null {
  const text = raw.trim();
  const fromUrl = text.match(/\/verify\/([A-Za-z0-9_-]{16,64})/);
  if (fromUrl) return fromUrl[1];
  return /^[A-Za-z0-9_-]{16,64}$/.test(text) ? text : null;
}

function Scanner({ onToken, onClose }: { onToken: (t: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let scanner: { stop: () => void; destroy: () => void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { default: QrScanner } = await import("qr-scanner");
        if (cancelled || !video.current) return;
        if (!(await QrScanner.hasCamera())) {
          setError("No camera found on this device. Enter the code printed under the QR instead.");
          return;
        }
        const s = new QrScanner(
          video.current,
          (result) => {
            const token = extractToken(result.data);
            if (token) {
              s.stop();
              onToken(token);
            }
          },
          { returnDetailedScanResult: true, highlightScanRegion: false, highlightCodeOutline: true, preferredCamera: "environment" },
        );
        scanner = s;
        await s.start();
      } catch {
        setError("We couldn't access the camera. Allow camera access in your browser, or enter the code manually.");
      }
    })();
    return () => {
      cancelled = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, [onToken]);

  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} className="space-y-4">
      <div className="relative aspect-square overflow-hidden rounded-3xl bg-ink-900">
        <video ref={video} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-10 rounded-3xl border-2 border-white/70" />
        {["left-8 top-8 border-l-4 border-t-4", "right-8 top-8 border-r-4 border-t-4", "left-8 bottom-8 border-b-4 border-l-4", "right-8 bottom-8 border-b-4 border-r-4"].map((c) => (
          <span key={c} className={`pointer-events-none absolute h-10 w-10 rounded-xl border-brand-500 ${c}`} />
        ))}
        <motion.div className="pointer-events-none absolute inset-x-12 h-0.5 rounded-full bg-brand-500 shadow-[0_0_18px_4px_rgb(242_92_5/0.6)]" animate={{ top: ["15%", "85%", "15%"] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />
      </div>
      {error ? <Alert tone="warn">{error}</Alert> : <p className="text-center text-sm text-ink-600">Point your camera at the ORIGINX QR code on the packaging.</p>}
      <Button variant="secondary" className="w-full" icon={<CameraOff className="h-4 w-4" />} onClick={onClose}>
        Close camera
      </Button>
    </motion.div>
  );
}

export default function VerifyHome() {
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Verify a product — ORIGINX";
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const token = extractToken(code);
    if (!token) return setError("That doesn't look like an ORIGINX code. Check the characters under the QR code and try again.");
    navigate(`/verify/${token}`);
  };

  return (
    <div className="min-h-screen bg-ink-50">
      <div aria-hidden className="grid-bg fixed inset-0 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />
      <div aria-hidden className="fixed -top-40 left-1/2 h-96 w-[40rem] -translate-x-1/2 rounded-full bg-brand-200/50 blur-[100px]" />
      <header className="relative mx-auto flex max-w-lg items-center justify-between px-5 py-5">
        <Logo />
        <Link to="/" className="text-sm font-semibold text-ink-500 hover:text-brand-600">
          About ORIGINX
        </Link>
      </header>
      <main className="relative mx-auto max-w-lg px-5 pb-16">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="pt-6 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-500 text-white shadow-glow">
            <ScanLine className="h-8 w-8" />
          </div>
          <h1 className="mt-6 text-3xl font-extrabold text-ink-900">Verify a product</h1>
          <p className="mt-2 text-ink-600">Check where it came from, who handled it, and whether it's genuine — in seconds.</p>
        </motion.div>

        <div className="mt-8 rounded-3xl border border-ink-200 bg-white p-5 shadow-lift sm:p-6">
          <AnimatePresence mode="wait">
            {scanning ? (
              <Scanner key="scan" onToken={(t) => navigate(`/verify/${t}`)} onClose={() => setScanning(false)} />
            ) : (
              <motion.div key="choose" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
                <Button size="lg" className="w-full" icon={<Camera className="h-5 w-5" />} onClick={() => setScanning(true)}>
                  Scan QR code
                </Button>
                <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-ink-400">
                  <span className="h-px flex-1 bg-ink-200" /> or enter the code <span className="h-px flex-1 bg-ink-200" />
                </div>
                <form onSubmit={submit} className="space-y-3">
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                    <Input
                      aria-label="Verification code or link"
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value);
                        setError(null);
                      }}
                      placeholder="Paste the code or link"
                      className="hash pl-10"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </div>
                  {error && <p className="text-sm text-bad-600">{error}</p>}
                  <Button type="submit" variant="dark" size="lg" className="w-full" disabled={!code.trim()}>
                    Verify
                  </Button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <ul className="mt-8 grid gap-3 text-sm text-ink-600">
          {[
            [UserX, "No account or app needed"],
            [Lock, "We never store your IP address — only an anonymous hash"],
            [ShieldCheck, "Results are checked against a public blockchain"],
          ].map(([Icon, text]) => {
            const I = Icon as typeof Lock;
            return (
              <li key={text as string} className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-white text-brand-600 ring-1 ring-ink-200">
                  <I className="h-4 w-4" />
                </span>
                {text as string}
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
