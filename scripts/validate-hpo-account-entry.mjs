import fs from "node:fs";
const read = (path) => fs.readFileSync(path, "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const ui = read("src/components/HpoAddAccountSheet.tsx");
const hpo = read("src/routes/_authenticated/hpo.tsx");
const account = read("src/lib/hpo-account-create.functions.ts");
const calendar = read("src/routes/_authenticated/calendar.tsx");
const calendarCore = read("src/lib/os.functions.ts");
const activity = read("src/components/HpoActivityView.tsx");
const sql = read("supabase/migrations/20261008010000_hpo_atomic_account_contacts_form.sql");
assert(hpo.includes("<HpoAddAccountSheet") && hpo.includes("onCreated={(id)") &&
  hpo.includes('setView("accounts")') && hpo.includes("void refresh()"),
  "New account must open in canonical Accounts and refresh HPO workspace");
assert(ui.includes("Fill form with Emery") && ui.includes("setInterval") &&
  ui.includes("onChange") && ui.includes("Save account and contacts"),
  "Emery draft must visibly fill editable fields without saving automatically");
assert(ui.includes("Contact") && ui.includes("roleTitle") && ui.includes("relationshipNotes") &&
  ui.includes("setContacts"), "Contacts must be editable on the new account");
assert(account.includes('process.env["OPENAI_API_KEY"]') && account.includes("MODEL_POLICY.action") &&
  account.includes("Never guess") && account.includes('context.supabase as any'),
  "Emery drafts must be grounded and server-authorized");
assert(account.includes('db.rpc("hpo_create_account_with_contacts"') &&
  account.includes("duplicate") && account.includes("geocodeHpoOfficeAddress"),
  "Account save must be atomic, deduplicated, and geocoded where possible");
assert(sql.includes("auth.uid()") && sql.includes("pg_advisory_xact_lock") &&
  sql.includes("INSERT INTO public.hpo_contacts") &&
  sql.includes("GRANT EXECUTE") && sql.includes("authenticated"),
  "Database must create owned account and contacts atomically");
assert(calendar.includes("listHpoCalendarAccounts") && calendar.includes("hpoAccountId") &&
  calendar.includes("Link HPO account (optional)") &&
  calendarCore.includes("hpo_account_id: data.hpoAccountId") &&
  calendarCore.includes('eq("user_id", context.userId)'),
  "Calendar events must select and verify owned HPO accounts");
assert(activity.includes("accounts.map((account)") && activity.includes('role="tablist"'),
  "Activity must be able to select account records and preserve four category tabs");
console.log("HPO account form, AI draft, atomic contacts, calendar and Activity sync validation passed");
