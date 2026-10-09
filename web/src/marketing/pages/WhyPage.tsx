import { PageHero } from "./PageHero";
import { FinalCta, PrivacyStrip, Problem, WhyChoose } from "../sections/Sections";

export default function WhyPage() {
  return (
    <>
      <PageHero docTitle="Why ORIGINX" eyebrow="Why choose us" title={<>Trust you can <span className="text-gradient">check,</span> not just claim.</>} description="Most supply-chain tools record what someone says happened. ORIGINX proves it, notices when it isn't true, and tells everyone who needs to know." />
      <Problem />
      <WhyChoose />
      <PrivacyStrip />
      <FinalCta />
    </>
  );
}
