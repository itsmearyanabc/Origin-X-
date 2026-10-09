import { PageHero } from "./PageHero";
import { Faq, FinalCta, PricingGrid } from "../sections/Sections";

export default function PricingPage() {
  return (
    <>
      <PageHero docTitle="Pricing" eyebrow="Pricing" title={<>Simple plans. <span className="text-gradient">Free verification, always.</span></>} description="Organizations pay for the products and people they manage. Consumers never pay and never need an account." />
      <section className="pb-24">
        <div className="container-x">
          <PricingGrid />
          <p className="mt-8 text-center text-sm text-ink-500">Paid plans are billed per organization. Contact us for volume, multi-brand or regulated-industry needs.</p>
        </div>
      </section>
      <Faq />
      <FinalCta />
    </>
  );
}
