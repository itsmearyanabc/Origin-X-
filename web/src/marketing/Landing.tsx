import { useEffect } from "react";
import { Hero } from "./sections/Hero";
import { Journey } from "./sections/Journey";
import { TamperDemo } from "./sections/TamperDemo";
import { Experiences, Faq, FeatureBento, FinalCta, IndustryMarquee, PricingTeaser, PrivacyStrip, Problem, WhyChoose } from "./sections/Sections";

export default function Landing() {
  useEffect(() => {
    document.title = "ORIGINX — Verifiable Identity for Physical Products";
  }, []);
  return (
    <>
      <Hero />
      <IndustryMarquee />
      <Problem />
      <Journey />
      <TamperDemo />
      <FeatureBento />
      <Experiences />
      <WhyChoose />
      <PrivacyStrip />
      <PricingTeaser />
      <Faq />
      <FinalCta />
    </>
  );
}
