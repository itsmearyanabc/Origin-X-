import { Link } from "react-router";
import { buttonClass } from "@/components/ui";
import { PageHero } from "./PageHero";

export default function NotFound() {
  return (
    <PageHero docTitle="Page not found" eyebrow="404" title="This page has no verified history." description="The link may be broken, or the page may have moved.">
      <div className="flex justify-center gap-3">
        <Link to="/" className={buttonClass("primary", "lg")}>Back home</Link>
        <Link to="/verify" className={buttonClass("secondary", "lg")}>Verify a product</Link>
      </div>
    </PageHero>
  );
}
