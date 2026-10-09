import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/format";

export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={show ? "text" : "password"} className="pr-11" {...props} />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted hover:text-fg" aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});

/** Server rule: ≥10 characters with letters and numbers. */
export function passwordScore(pw: string) {
  let score = 0;
  if (pw.length >= 10) score++;
  if (/[A-Za-z]/.test(pw) && /[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 14) score++;
  if (pw.length >= 16 && /[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  return score;
}

export function PasswordStrength({ value }: { value: string }) {
  const score = passwordScore(value);
  const labels = ["Too short", "Weak", "Good", "Strong", "Excellent"];
  const colors = ["bg-ink-200", "bg-bad-500", "bg-warn-500", "bg-ok-500", "bg-ok-600"];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((n) => (
          <span key={n} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", n < score ? colors[score] : "bg-ink-200")} />
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">{value ? labels[score] : "At least 10 characters, with letters and numbers."}</p>
    </div>
  );
}

export const passwordRule = (pw: string) => pw.length >= 10 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
