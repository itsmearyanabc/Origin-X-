import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertOctagon, Blocks, CheckCircle2, Database, Pencil, RotateCcw, ShieldAlert, Wand2 } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/format";
import { easeOutExpo, SectionHeading } from "../shared";

const GENESIS = "0".repeat(64);
const BASE = [
  { type: "Registered", location: "ABC Pharma, Delhi" },
  { type: "Manufactured", location: "Plant 1, Delhi" },
  { type: "Quality approved", location: "QC Lab, Delhi" },
  { type: "Custody → SwiftLogix", location: "Delhi Hub" },
  { type: "Warehouse received", location: "MetroCare, Gurugram" },
];

type Block = { type: string; location: string; prev: string; hash: string };
type Mode = "intact" | "naive" | "rewrite";

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
const payload = (b: { type: string; location: string }, seq: number) => JSON.stringify({ seq, type: b.type, location: b.location });

async function buildChain(items: Array<{ type: string; location: string }>): Promise<Block[]> {
  const out: Block[] = [];
  let prev = GENESIS;
  for (const [i, item] of items.entries()) {
    const hash = await sha256(`${payload(item, i + 1)}|${prev}`);
    out.push({ ...item, prev, hash });
    prev = hash;
  }
  return out;
}

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

export function TamperDemo() {
  const [anchors, setAnchors] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [recomputed, setRecomputed] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("intact");

  const reset = useCallback(async () => {
    const chain = await buildChain(BASE);
    setAnchors(chain.map((b) => b.hash));
    setBlocks(chain);
    setMode("intact");
  }, []);

  useEffect(() => {
    reset();
  }, [reset]);

  // Re-verify whenever the database records change.
  useEffect(() => {
    let cancel = false;
    Promise.all(blocks.map((b, i) => sha256(`${payload(b, i + 1)}|${b.prev}`))).then((r) => !cancel && setRecomputed(r));
    return () => {
      cancel = true;
    };
  }, [blocks]);

  const tamperNaive = async () => {
    const chain = await buildChain(BASE);
    chain[2] = { ...chain[2], location: "Unlicensed site, Noida" };
    setBlocks(chain);
    setMode("naive");
  };

  const tamperRewrite = async () => {
    const edited = BASE.map((b, i) => (i === 2 ? { ...b, location: "Unlicensed site, Noida" } : b));
    setBlocks(await buildChain(edited));
    setMode("rewrite");
  };

  const status = blocks.map((b, i) => {
    const contentOk = recomputed[i] === b.hash;
    const linkOk = b.prev === (i === 0 ? GENESIS : blocks[i - 1].hash);
    const anchorOk = anchors[i] === b.hash;
    return { contentOk, linkOk, anchorOk };
  });
  const firstBad = status.findIndex((s) => !s.contentOk || !s.linkOk || !s.anchorOk);
  const dbChainOk = status.every((s) => s.contentOk && s.linkOk);
  const chainOk = firstBad === -1;

  return (
    <section className="relative overflow-hidden bg-ink-950 py-24 text-white">
      <div aria-hidden className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:44px_44px]" />
      <div aria-hidden className="absolute -top-32 left-1/2 h-96 w-[60rem] -translate-x-1/2 rounded-full bg-brand-500/20 blur-[120px]" />
      <div className="container-x relative">
        <div className="[&_h2]:text-white [&_p]:text-ink-300">
          <SectionHeading
            eyebrow="Try to tamper with it"
            title={<>Edit one record. <span className="text-gradient">Watch the chain refuse it.</span></>}
            description="These are real SHA-256 hashes, computed in your browser right now. Each record's hash covers its content and the hash before it — and the originals are anchored on a blockchain."
          />
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          <Button variant="primary" icon={<Pencil className="h-4 w-4" />} onClick={tamperNaive} disabled={mode === "naive"}>
            Edit event #3 in the database
          </Button>
          <Button variant="secondary" className="border-white/15 bg-white/5 text-white hover:bg-white/10" icon={<Wand2 className="h-4 w-4" />} onClick={tamperRewrite} disabled={mode === "rewrite"}>
            Edit it and re-hash everything
          </Button>
          <Button variant="ghost" className="text-ink-300 hover:bg-white/10 hover:text-white" icon={<RotateCcw className="h-4 w-4" />} onClick={reset} disabled={mode === "intact"}>
            Reset
          </Button>
        </div>

        {/* Verdict */}
        <div className="mx-auto mt-8 max-w-3xl" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${mode}-${chainOk}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4, ease: easeOutExpo }}
              className={cn("flex items-start gap-3 rounded-2xl px-5 py-4 ring-1", chainOk ? "bg-ok-500/10 text-ok-100 ring-ok-500/30" : "bg-bad-500/10 text-bad-100 ring-bad-500/30")}
            >
              {chainOk ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok-500" /> : <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-bad-500" />}
              <div>
                <p className="font-semibold text-white">{chainOk ? "History verified — 5 / 5 events intact" : "HISTORY COMPROMISED"}</p>
                <p className="mt-0.5 text-sm text-ink-300">
                  {mode === "intact" && "Every hash recomputes, every link matches, every anchor agrees with the blockchain."}
                  {mode === "naive" && "Event #3 no longer matches its own hash. It and every event after it can no longer be trusted."}
                  {mode === "rewrite" &&
                    "The attacker recomputed every hash, so the database chain looks perfectly consistent — but the hashes anchored on the blockchain can't be rewritten. Events #3 to #5 are exposed."}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Chain */}
        <div className="mt-10 overflow-x-auto pb-4">
          <div className="mx-auto min-w-[880px] max-w-6xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
              <Database className="h-4 w-4" /> Database records
              <span className={cn("ml-2 rounded-full px-2 py-0.5 normal-case tracking-normal", dbChainOk ? "bg-ok-500/15 text-ok-500" : "bg-bad-500/15 text-bad-500")}>{dbChainOk ? "hash chain consistent" : "hash chain broken"}</span>
            </div>
            <div className="grid grid-cols-5 gap-4">
              {blocks.map((b, i) => {
                const s = status[i];
                const tampered = s && !s.contentOk;
                const exposed = s && s.contentOk && !s.anchorOk;
                const affected = firstBad !== -1 && i > firstBad && !tampered && !exposed;
                const bad = tampered || exposed;
                return (
                  <motion.div
                    key={i}
                    layout
                    animate={bad ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
                    transition={{ duration: 0.5, delay: bad ? 0.1 : 0 }}
                    className={cn(
                      "relative rounded-2xl border p-4 transition-colors duration-500",
                      bad ? "border-bad-500/60 bg-bad-500/10" : affected ? "border-warn-500/50 bg-warn-500/10" : "border-white/10 bg-white/[0.04]",
                    )}
                  >
                    {i < blocks.length - 1 && (
                      <span className={cn("absolute -right-4 top-1/2 h-0.5 w-4 transition-colors duration-500", (status[i + 1] && !status[i + 1].linkOk) || bad || affected ? "bg-bad-500/70" : "bg-brand-500")} />
                    )}
                    <div className="flex items-center justify-between">
                      <span className="hash text-ink-400">#{String(i + 1).padStart(2, "0")}</span>
                      <motion.span
                        key={`${mode}-${i}`}
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: firstBad === -1 ? 0 : Math.max(0, i - firstBad) * 0.18 + 0.15 }}
                        className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", bad ? "bg-bad-500 text-white" : affected ? "bg-warn-500 text-ink-900" : "bg-ok-500/20 text-ok-500")}
                      >
                        {tampered ? "Tampered" : exposed ? "Not on chain" : affected ? "Affected" : "Valid"}
                      </motion.span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-white">{b.type}</p>
                    <p className={cn("mt-0.5 text-xs transition-colors", i === 2 && mode !== "intact" ? "font-semibold text-bad-500" : "text-ink-400")}>{b.location}</p>
                    <div className="mt-3 space-y-1 text-[11px]">
                      <p className="text-ink-500">
                        prev <span className="hash text-ink-300">{short(b.prev)}</span>
                      </p>
                      <p className="text-ink-500">
                        hash <span className={cn("hash", bad ? "text-bad-500" : "text-ink-200")}>{short(b.hash)}</span>
                      </p>
                      {tampered && recomputed[i] && (
                        <p className="text-bad-500">
                          recomputed <span className="hash">{short(recomputed[i])}</span>
                        </p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <div className="mb-3 mt-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
              <Blocks className="h-4 w-4" /> Blockchain anchors (write-once)
            </div>
            <div className="grid grid-cols-5 gap-4">
              {anchors.map((a, i) => {
                const ok = blocks[i]?.hash === a;
                return (
                  <div key={i} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors duration-500", ok ? "border-ok-500/30 bg-ok-500/[0.07]" : "border-bad-500/50 bg-bad-500/10")}>
                    {ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok-500" /> : <AlertOctagon className="h-4 w-4 shrink-0 text-bad-500" />}
                    <span className="hash truncate text-[11px] text-ink-300">{short(a)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
