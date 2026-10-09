import { PageHero } from "./PageHero";
import { Journey } from "../sections/Journey";
import { Faq, FinalCta } from "../sections/Sections";

export default function HowItWorksPage() {
  return (
    <>
      <PageHero docTitle="How it works" eyebrow="How ORIGINX works" title={<>Identify. Verify. Detect. <span className="text-gradient">Explain. Respond.</span></>} description="Follow one product from the factory floor to a customer's scan, and see exactly what ORIGINX checks along the way." />
      <Journey />
      <Faq />
      <FinalCta />
    </>
  );
}
