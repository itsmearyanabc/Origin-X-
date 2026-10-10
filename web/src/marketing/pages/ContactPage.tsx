import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "motion/react";
import { CheckCircle2, Mail, MessageSquare, ShieldCheck } from "lucide-react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { PageHero } from "./PageHero";
import { Turnstile, useTurnstileSiteKey, type TurnstileHandle } from "@/components/Turnstile";

const schema = z.object({
  name: z.string().trim().min(2, "Please enter your name."),
  email: z.string().trim().email("Please enter a valid email."),
  company: z.string().trim().max(160).optional(),
  topic: z.enum(["GENERAL", "SALES", "SUPPORT", "SECURITY", "PRIVACY"]),
  message: z.string().trim().min(10, "Please write at least 10 characters.").max(5000),
  website: z.string().max(0).optional(),
});
type Form = z.infer<typeof schema>;

export default function ContactPage() {
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState, reset } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { topic: "GENERAL" } });

  const { siteKey: humanCheckKey } = useTurnstileSiteKey();
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const humanCheck = useRef<TurnstileHandle>(null);
  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api.public<{ reference: string }>("POST", "/site/contact", { ...values, turnstileToken: humanToken ?? undefined });
      setReference(res.reference);
      reset();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      humanCheck.current?.reset();
    }
  });

  return (
    <>
      <PageHero docTitle="Contact" eyebrow="Contact" title={<>Let's make your products <span className="text-gradient">provable.</span></>} description="Questions about ORIGINX, a pilot for your supply chain, or a security report — we read every message." />
      <section className="pb-24">
        <div className="container-x grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-4">
            {[
              { icon: MessageSquare, title: "Sales & pilots", text: "Tell us about your products, partners and volume." },
              { icon: Mail, title: "Support", text: "Existing customers: include your organization name." },
              { icon: ShieldCheck, title: "Security & privacy", text: "Responsible disclosure and data requests." },
            ].map((c) => (
              <div key={c.title} className="flex gap-4 rounded-3xl border border-ink-200 bg-white p-6 shadow-soft">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600">
                  <c.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-bold text-ink-900">{c.title}</p>
                  <p className="mt-1 text-sm text-ink-600">{c.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-3xl border border-ink-200 bg-white p-6 shadow-soft sm:p-8">
            {reference ? (
              <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center py-12 text-center">
                <CheckCircle2 className="h-12 w-12 text-ok-600" />
                <h2 className="mt-4 text-2xl font-bold text-ink-900">Message received</h2>
                <p className="mt-2 text-ink-600">
                  Your reference is <span className="hash rounded bg-ink-100 px-2 py-0.5 text-ink-800">{reference}</span>. We'll reply by email.
                </p>
                <Button variant="secondary" className="mt-6" onClick={() => setReference(null)}>
                  Send another message
                </Button>
              </motion.div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-5" noValidate>
                {error && <Alert tone="bad">{error}</Alert>}
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Name" required error={formState.errors.name?.message}>
                    {(id) => <Input id={id} autoComplete="name" aria-invalid={Boolean(formState.errors.name)} {...register("name")} />}
                  </Field>
                  <Field label="Work email" required error={formState.errors.email?.message}>
                    {(id) => <Input id={id} type="email" autoComplete="email" aria-invalid={Boolean(formState.errors.email)} {...register("email")} />}
                  </Field>
                  <Field label="Company">{(id) => <Input id={id} autoComplete="organization" {...register("company")} />}</Field>
                  <Field label="Topic">
                    {(id) => (
                      <Select id={id} {...register("topic")}>
                        <option value="GENERAL">General question</option>
                        <option value="SALES">Sales / pilot</option>
                        <option value="SUPPORT">Support</option>
                        <option value="SECURITY">Security report</option>
                        <option value="PRIVACY">Privacy / data request</option>
                      </Select>
                    )}
                  </Field>
                </div>
                <Field label="Message" required error={formState.errors.message?.message}>
                  {(id) => <Textarea id={id} rows={6} aria-invalid={Boolean(formState.errors.message)} {...register("message")} />}
                </Field>
                {/* Honeypot for bots — hidden from people and assistive tech */}
                <input type="text" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden {...register("website")} />
                <p className="text-xs text-ink-500">
                  We use your details only to reply. See our <a href="/privacy" className="font-semibold text-brand-600 hover:underline">privacy policy</a>.
                </p>
                <Turnstile ref={humanCheck} action="contact" onToken={setHumanToken} className="sm:flex sm:justify-start" />
                <Button type="submit" size="lg" loading={formState.isSubmitting} disabled={Boolean(humanCheckKey) && !humanToken} className="w-full sm:w-auto">
                  Send message
                </Button>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
