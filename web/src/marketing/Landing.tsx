import { useEffect } from "react";
/**
 * The public landing experience is the supplied Claude Design export. It is
 * retained as a self-contained bundle so its original typography, responsive
 * layout and interaction timing are not approximated by a second build.
 */
export default function Landing() {
  useEffect(() => {
    document.title = "ORIGINX — Verifiable identity for physical products";
    // Load the exported page as the top-level document. The design bundle
    // creates blob-backed runtime documents, which inherit the embedding
    // document's CSP when shown inside an iframe.
    window.location.replace("/claude-design/Origin%20X%20Landing.html");
  }, []);

  return null;
}
