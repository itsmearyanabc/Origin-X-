import { PageHero } from "./PageHero";
import { Experiences, FeatureBento, FinalCta } from "../sections/Sections";
import { TamperDemo } from "../sections/TamperDemo";

export default function FeaturesPage() {
  return (
    <>
      <PageHero docTitle="Features" eyebrow="Features & specialities" title={<>A complete trust layer, <span className="text-gradient">not a tracking spreadsheet.</span></>} description="Passports, tamper-evident history, blockchain proof, two-party custody, an explainable trust engine, counterfeit detection and recalls — in one multi-tenant platform." />
      <FeatureBento />
      <TamperDemo />
      <Experiences />
      <FinalCta />
    </>
  );
}
