import { useEffect } from "react";
/**
 * The public landing experience is the supplied Claude Design export. It is
 * retained as a self-contained bundle so its original typography, responsive
 * layout and interaction timing are not approximated by a second build.
 */
export default function Landing() {
  useEffect(() => {
    document.title = "ORIGINX — Verifiable identity for physical products";
  }, []);

  return <iframe title="ORIGINX" src="/claude-design/Origin%20X%20Landing.html" className="block h-dvh w-full border-0 bg-white" allow="clipboard-read; clipboard-write" />;
}
