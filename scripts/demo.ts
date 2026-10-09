/**
 * Runs the four ORIGINX demo scenarios live against a running API (npm run dev), using the data
 * created by `npm run db:seed`. Scenarios 2–4 change state; re-seed (npm run db:reset) to repeat.
 *
 *   npm run demo            # all scenarios
 *   npm run demo -- 3       # only scenario 3
 */
import fs from "node:fs";

type Demo = { apiUrl: string; password: string; tokens: Record<string, string>; tamperDemo: { naive: string; rewrite: string }; recallDemo: string; genuineA92: string };
const demo = JSON.parse(fs.readFileSync(".originx-demo.json", "utf8")) as Demo;
const API = `${process.env.API_URL ?? demo.apiUrl}/api/v1`;
const only = process.argv[2];

const c = { bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m", reset: "\x1b[0m" };
const banner = (title: string) => console.log(`\n${c.bold}${c.cyan}━━━ ${title} ━━━${c.reset}`);
const stateColor = (s: string) => (["HISTORY_VERIFIED", "AUTHENTIC"].includes(s) ? c.green : s === "SUSPICIOUS" ? c.yellow : c.red);

async function call<T = any>(method: string, path: string, body?: unknown, token?: string, orgId?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(orgId ? { "x-organization-id": orgId } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { success: boolean; data: T; error?: { code: string; message: string } };
  if (!json.success) throw new Error(`${method} ${path} -> ${res.status} ${json.error?.code}: ${json.error?.message}`);
  return json.data;
}

async function signIn(email: string) {
  const session = await call<{ accessToken: string }>("POST", "/auth/login", { email, password: demo.password });
  const me = await call<{ organizations: Array<{ organizationId: string; name: string }> }>("GET", "/auth/me", undefined, session.accessToken);
  return { token: session.accessToken, orgId: me.organizations[0]?.organizationId };
}

function showPublic(v: any) {
  console.log(`  State:       ${stateColor(v.state)}${c.bold}${v.state}${c.reset} — ${v.headline}`);
  if (v.passport) {
    const p = v.passport;
    console.log(`  Product:     ${p.productName} (${p.productCode}), batch ${p.batch}`);
    console.log(`  Brand:       ${p.brand.name}${p.brand.verified ? " ✓ verified" : ""}`);
    console.log(`  Origin:      ${p.origin.location}`);
    console.log(`  Trust score: ${c.bold}${p.trust.score}/100 (${p.trust.level})${c.reset}`);
    console.log(`  History:     ${p.integrity.eventsVerified}/${p.integrity.eventCount} events verified`);
    console.log(`  Blockchain:  ${p.blockchain.status} — ${p.blockchain.verifiedEvents}/${p.blockchain.anchoredEvents} anchored events on ${p.blockchain.network} (chain ${p.blockchain.chainId})`);
    for (const w of v.warnings ?? []) console.log(`  ${c.yellow}⚠ ${w}${c.reset}`);
  }
}

async function scenario1() {
  banner("SCENARIO 1 — Normal: Vaccine Batch A92");
  const v = await call("GET", `/verify/${demo.tokens["RX-29481"]}`);
  showPublic(v);
  console.log(`  ${c.dim}Lifecycle:${c.reset}`);
  for (const e of v.passport.lifecycle) {
    console.log(`   #${e.sequence} ${e.eventType.padEnd(20)} ${new Date(e.timestamp).toISOString().slice(0, 16)}  ${(e.location ?? "").padEnd(38)} ${e.blockchain?.transactionHash?.slice(0, 18) ?? ""}…`);
  }
}

async function scenario2() {
  banner("SCENARIO 2 — Tampering");
  const abc = await signIn("owner@abcpharma.local");
  for (const [mode, productId] of [["naive", demo.tamperDemo.naive], ["rewrite", demo.tamperDemo.rewrite]] as const) {
    console.log(`\n  ${c.bold}Attack: ${mode === "naive" ? "edit event #3 in the database" : "edit event #3 AND recompute every downstream hash"}${c.reset}`);
    const r = await call("POST", `/products/${productId}/demo/tamper`, { mode, sequence: 3, change: { location: "Unlicensed warehouse, Noida" } }, abc.token, abc.orgId);
    console.log(`  Before: history ${r.before.historyValid ? c.green + "VALID" : c.red + "INVALID"}${c.reset}, trust ${r.before.trustScore}, blockchain ${r.before.blockchain}`);
    console.log(`  After:  history ${c.red}${c.bold}COMPROMISED${c.reset}, trust ${c.red}${r.after.trustScore} (${r.after.trustLevel})${c.reset}, blockchain ${r.after.blockchain}`);
    console.log(`  DB hash chain looks consistent: ${r.after.databaseChainLooksValid}`);
    for (const t of r.after.tamperedEvents) console.log(`   ✗ event #${t.sequence} ${t.eventType}: stored ${t.storedHash.slice(0, 12)}… recomputed ${t.recomputedHash.slice(0, 12)}…${t.anchoredHash ? ` on-chain ${t.anchoredHash.slice(0, 12)}…` : ""}`);
    console.log(`   Affected downstream events: ${r.after.affectedEvents.length}, penalties: ${r.after.penalties.join(", ")}`);
    console.log(`  ${c.dim}${r.note}${c.reset}`);
  }
}

async function scenario3() {
  banner("SCENARIO 3 — Counterfeit: duplicate identity registration");
  const shadow = await signIn("owner@shadow.local");
  const r = await call("POST", "/products", { productCode: "RX-29481", serialNumber: "A92-000417", productName: "OrigiVax Influenza Vaccine", originLocation: "Delhi, India", originCountry: "IN" }, shadow.token, shadow.orgId);
  console.log(`  Shadow Pharma Traders tried to register RX-29481 / A92-000417`);
  console.log(`  Result: ${c.red}${c.bold}${r.collision.code}${c.reset} → product ${r.product.status}, identity ${r.product.identity.status}`);
  const v = await call("GET", `/verify/${r.product.publicVerificationToken}`);
  console.log("  Consumer scanning the counterfeit:");
  showPublic(v);
  const abc = await signIn("owner@abcpharma.local");
  const incidents = await call<any[]>("GET", "/incidents?type=IDENTITY_COLLISION", undefined, abc.token, abc.orgId);
  console.log(`  ABC Pharma incident: ${incidents[0]?.severity} — ${incidents[0]?.description}`);
}

async function scenario4() {
  banner("SCENARIO 4 — Recall: Glucora insulin pens, batch C7");
  const token = demo.tokens["GLU-C7-PEN"];
  console.log("  Before recall:");
  showPublic(await call("GET", `/verify/${token}`));
  const abc = await signIn("owner@abcpharma.local");
  await call("POST", "/recalls", { productId: demo.recallDemo, reason: "Potency below specification in stability testing (lot C7).", initiate: true }, abc.token, abc.orgId);
  console.log("\n  After ABC Pharma initiates the recall:");
  const v = await call("GET", `/verify/${token}`);
  showPublic(v);
  console.log(`  Recall: ${v.passport.recall.status} — ${v.passport.recall.reason}`);
}

const scenarios = [scenario1, scenario2, scenario3, scenario4];
try {
  for (const [i, run] of scenarios.entries()) if (!only || only === String(i + 1)) await run();
  console.log("");
} catch (error) {
  console.error(`\n${c.red}${(error as Error).message}${c.reset}\nIs the API running (npm run dev) and the database seeded (npm run db:seed)?`);
  process.exit(1);
}
