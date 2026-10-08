import { useEffect, useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, MessageCircle, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  emeryDraftHpoAccount, saveHpoAccountWithContacts,
  type HpoAccountDraft,
} from "@/lib/hpo-account-create.functions";

type Contact = HpoAccountDraft["contacts"][number];
type Account = HpoAccountDraft["account"];
const EMPTY: Account = {
  name: "", accountType: "Doctor", specialty: "", territory: "",
  address: "", city: "", priority: 3, ownerName: "",
  relationshipStage: "prospect", notes: "",
};
const emptyContact = (): Contact => ({
  name: "", roleTitle: "", phone: "", email: "", relationshipNotes: "",
});
const inputClass = "mt-1.5 min-h-11 w-full rounded-xl border border-border bg-background/70 px-3 text-base text-foreground outline-none focus:border-primary";
const textareaClass = inputClass + " min-h-24 py-3";
const LABELS: Array<[keyof Account, string]> = [
  ["name", "Office name"], ["accountType", "Account type"],
  ["specialty", "Specialty / practice"], ["address", "Physical address"],
  ["city", "City"], ["territory", "Territory"], ["ownerName", "Account owner"],
  ["relationshipStage", "Relationship stage"], ["priority", "Priority"], ["notes", "Relationship notes"],
];
const TYPE_OPTIONS = ["Doctor", "Primary Care", "Urgent Care", "Attorney", "PT/Chiro", "MRI", "Other"];

export function HpoAddAccountSheet({
  onClose, onCreated, onExisting,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  onExisting: (id: string) => void;
}) {
  const draft = useServerFn(emeryDraftHpoAccount);
  const save = useServerFn(saveHpoAccountWithContacts);
  const [account, setAccount] = useState<Account>(EMPTY);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [filling, setFilling] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const updateAccount = (key: keyof Account, value: string | number) => {
    setAccount((current) => ({ ...current, [key]: value }));
    setDuplicateId(null);
  };
  const updateContact = (index: number, key: keyof Contact, value: string) => {
    setContacts((previous) => previous.map((item, idx) =>
      idx === index ? { ...item, [key]: value } : item));
  };

  async function fillWithEmery() {
    if (!prompt.trim() || working || filling) return;
    setError(""); setNotice(""); setStatus("Emery is reading your description…");
    setWorking(true);
    try {
      const result = await draft({ data: { message: prompt } });
      setWorking(false);
      setFilling(true);
      setStatus("Emery is filling the form. Review every field before saving.");
      setAccount(EMPTY); setContacts([]); setDuplicateId(null);
      // Apply draft properties one at a time after inference, so every field
      // visibly fills in and remains manually editable.
      const queue: Array<() => void> = LABELS.map(([key]) => () => {
        const value = result.account[key];
        if (key === "priority") {
          setAccount((current) => ({ ...current, priority: Number(value) || 3 }));
        } else {
          setAccount((current) => ({ ...current, [key]: String(value ?? "") }));
        }
      });
      result.contacts.forEach((person) => queue.push(() =>
        setContacts((current) => [...current, person])));
      let next = 0;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        const step = queue[next++];
        if (step) step();
        if (next >= queue.length) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          setFilling(false);
          setNotice(result.notice);
          setStatus("Emery's draft is ready. You control what gets saved.");
        }
      }, 130);
    } catch (cause) {
      setWorking(false); setFilling(false);
      setStatus("");
      setError(cause instanceof Error ? cause.message : "Emery couldn't fill the form.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || filling || saving) return;
    setError(""); setDuplicateId(null); setSaving(true);
    try {
      const missingContact = contacts.find((person) =>
        !person.name.trim() && [person.roleTitle, person.phone, person.email,
          person.relationshipNotes].some((v) => Boolean(v.trim())));
      if (missingContact) throw new Error("Enter a contact name, or remove the unfinished contact.");
      const result = await save({ data: {
        account, contacts: contacts.filter((person) => person.name.trim()),
      } });
      if (result.duplicate) {
        setDuplicateId(result.accountId);
        setError("This office already exists in Emery. Open its record instead of creating a duplicate.");
        return;
      }
      setStatus(`Saved with ${result.contactsCreated} contact(s).`);
      onCreated(result.accountId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save the account.");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-background/80 sm:items-center sm:p-4"
      role="presentation" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label="Add HPO account"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[95dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold">Add HPO account</h2>
            <p className="text-xs text-muted-foreground">Office, people, relationship context — one CRM record</p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="size-11"
            aria-label="Close add account" onClick={onClose}><X className="size-5"/></Button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <section className="mb-5 space-y-3 rounded-2xl border border-primary/25 bg-primary/[0.035] p-3.5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary"/>
              <h3 className="text-sm font-semibold">Fill with Emery</h3>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Tell Emery about the office and the people you know. Watch her prepare the fields,
              correct anything you like, then you press Save. She will not guess missing facts or save for you.
            </p>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
              disabled={working || filling} rows={3} maxLength={9000}
              placeholder="Add Hudson Family Medicine in Morris Plains, 10 Main Street. My contact is Maria, office manager, maria@example.com. We met yesterday…"
              aria-label="Describe the account to Emery"
              className={textareaClass}/>
            <Button type="button" onClick={() => void fillWithEmery()}
              disabled={working || filling || prompt.trim().length < 8}
              className="min-h-11 w-full gap-2">
              <MessageCircle className="size-4"/>
              {working ? "Emery is preparing…" : filling ? "Filling the form…" : "Fill form with Emery"}
            </Button>
            {status && <p role="status" className="flex items-start gap-2 text-xs text-primary">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0"/>{status}
            </p>}
            {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
          </section>

          <form id="hpo-new-account-form" onSubmit={(e) => void submit(e)} className="space-y-5">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Office information</h3>
              <label className="block text-xs font-medium">Office name *
                <input required maxLength={180} autoComplete="organization"
                  value={account.name} onChange={(e) => updateAccount("name",e.target.value)} className={inputClass}/>
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium">Account type
                  <select value={account.accountType}
                    onChange={(e) => updateAccount("accountType",e.target.value)} className={inputClass}>
                    <option value="">Choose account type</option>
                    {account.accountType && !TYPE_OPTIONS.includes(account.accountType) && (
                      <option value={account.accountType}>{account.accountType}</option>
                    )}
                    {TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-medium">Specialty / practice
                  <input maxLength={120} value={account.specialty}
                    placeholder="Internal Medicine, Personal Injury…"
                    onChange={(e) => updateAccount("specialty",e.target.value)} className={inputClass}/>
                </label>
              </div>
              <label className="block text-xs font-medium">Physical street address
                <input maxLength={350} value={account.address} autoComplete="street-address"
                  placeholder="Street, suite, state, ZIP"
                  onChange={(e) => updateAccount("address",e.target.value)} className={inputClass}/>
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium">City
                  <input maxLength={100} value={account.city} autoComplete="address-level2"
                    onChange={(e) => updateAccount("city",e.target.value)} className={inputClass}/>
                </label>
                <label className="block text-xs font-medium">Territory
                  <input maxLength={120} value={account.territory}
                    placeholder="Morris Plains, North Jersey…"
                    onChange={(e) => updateAccount("territory",e.target.value)} className={inputClass}/>
                </label>
                <label className="block text-xs font-medium">Account owner
                  <input maxLength={150} value={account.ownerName}
                    onChange={(e) => updateAccount("ownerName",e.target.value)} className={inputClass}/>
                </label>
                <label className="block text-xs font-medium">Relationship stage
                  <select value={account.relationshipStage}
                    onChange={(e) => updateAccount("relationshipStage",e.target.value)} className={inputClass}>
                    {["prospect", "contacted", "developing", "active", "established"].map((v) =>
                      <option key={v} value={v}>{v.charAt(0).toUpperCase()+v.slice(1)}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-medium">Priority (1–5)
                  <select value={account.priority}
                    onChange={(e) => updateAccount("priority",Number(e.target.value))} className={inputClass}>
                    {[1,2,3,4,5].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              </div>
              <label className="block text-xs font-medium">Account / relationship notes
                <textarea maxLength={4000} rows={3} value={account.notes}
                  placeholder="How you know the office, referrals, opportunities, next relationship step…"
                  onChange={(e) => updateAccount("notes",e.target.value)} className={textareaClass}/>
              </label>
            </section>
            <section className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">People at this account</h3>
                  <p className="text-xs text-muted-foreground">Add the attorney, doctor, office manager, front desk, or other contacts you know.</p>
                </div>
                <Button type="button" variant="outline" className="min-h-11 shrink-0 gap-1"
                  onClick={() => setContacts((previous) => [...previous,emptyContact()])}
                  disabled={contacts.length >= 20}><Plus className="size-4"/> Contact</Button>
              </div>
              {contacts.length === 0 && <p className="rounded-xl border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                No contacts added yet. You can always add contacts later in the account.
              </p>}
              {contacts.map((person,index) => (
                <article key={index} className="space-y-2 rounded-xl border border-border bg-card/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Contact {index+1}</p>
                    <Button type="button" variant="ghost" size="icon" className="size-10"
                      aria-label={`Remove contact ${index+1}`}
                      onClick={() => setContacts((current) => current.filter((_,i)=>i!==index))}>
                      <Trash2 className="size-4"/>
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {([
                      ["name","Name"], ["roleTitle","Role / position"],
                      ["phone","Phone"], ["email","Email"],
                    ] as Array<[keyof Contact,string]>).map(([key,label]) =>
                      <label key={key} className="block text-xs font-medium">{label}{key==="name"?" *":""}
                        <input value={person[key]} maxLength={key==="email"?200:150}
                          type={key==="email"?"email":key==="phone"?"tel":"text"}
                          onChange={(e) => updateContact(index,key,e.target.value)} className={inputClass}/>
                      </label>)}
                  </div>
                  <label className="block text-xs font-medium">Relationship / contact notes
                    <textarea rows={2} maxLength={1500} value={person.relationshipNotes}
                      onChange={(e) => updateContact(index,"relationshipNotes",e.target.value)} className={textareaClass}/>
                  </label>
                </article>
              ))}
            </section>
            <p className="text-xs text-muted-foreground">
              Saving creates one HPO account and its contacts. Activities and calendar entries can
              then link to this account. Full address and city are needed to place a pin on Maps.
              Please keep patient information out of relationship notes.
            </p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {duplicateId && <Button type="button" className="min-h-11 w-full"
              onClick={() => onExisting(duplicateId)}>Open existing account</Button>}
            <Button type="submit" className="min-h-12 w-full"
              disabled={working || filling || saving || !account.name.trim()}>
              {saving ? "Saving office and contacts…" : "Save account and contacts"}
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
