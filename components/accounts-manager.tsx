"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Power, KeyRound, RefreshCw } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase-browser";
import type { Account, AccountStatus } from "@/lib/types";
import { MAX_ACCOUNTS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AccountStatusBadge } from "@/components/account-status-badge";

type WizardStep = "details" | "code" | "2fa" | "done";

const postJson = async (url: string, body?: unknown) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
};

export const AccountsManager = ({ initial }: { initial: Account[] }) => {
  const [accounts, setAccounts] = useState<Account[]>(initial);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>("details");
  const [busy, setBusy] = useState(false);

  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/accounts", { cache: "no-store" });
    const data = await res.json();
    if (data.accounts) setAccounts(data.accounts as Account[]);
  }, []);

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel("kw_accounts_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kw_accounts" },
        () => void refresh()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  const resetWizard = () => {
    setStep("details");
    setLabel("");
    setPhone("");
    setCode("");
    setPassword("");
    setActiveId(null);
    setBusy(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) resetWizard();
  };

  const handleStartLogin = async () => {
    if (!label.trim() || !phone.trim()) {
      toast.error("Enter a label and phone number.");
      return;
    }
    setBusy(true);
    try {
      const data = await postJson("/api/accounts", { label, phone });
      setActiveId(data.account.id);
      await refresh();
      if (data.warning) {
        toast.warning(data.warning);
        return;
      }
      toast.success("Code sent to the phone via Telegram.");
      setStep("code");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitCode = async () => {
    if (!activeId || !code.trim()) return;
    setBusy(true);
    try {
      const data = await postJson(`/api/accounts/${activeId}/code`, { code });
      await refresh();
      if (data.status === "awaiting_2fa") {
        toast.info("Two-factor password required.");
        setStep("2fa");
        return;
      }
      toast.success("Account connected.");
      setStep("done");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit2fa = async () => {
    if (!activeId || !password.trim()) return;
    setBusy(true);
    try {
      await postJson(`/api/accounts/${activeId}/2fa`, { password });
      await refresh();
      toast.success("Account connected.");
      setStep("done");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Wrong password");
    } finally {
      setBusy(false);
    }
  };

  const resumeLogin = async (account: Account) => {
    setActiveId(account.id);
    setLabel(account.label);
    setPhone(account.phone);
    setOpen(true);
    if (account.status === "awaiting_2fa") {
      setStep("2fa");
    } else {
      setStep("code");
    }
  };

  const reconnect = async (account: Account) => {
    try {
      await postJson(`/api/accounts/${account.id}/login`);
      toast.success("Code re-sent. Open the account to enter it.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const disconnect = async (account: Account) => {
    try {
      await postJson(`/api/accounts/${account.id}/disconnect`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const remove = async (account: Account) => {
    const ok = window.confirm(
      `Remove "${account.label}"? It will be disconnected and freed from your account slots. Its chat history is kept under Conversations (shown as a removed account).`
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await refresh();
      toast.success("Account removed. Its conversations are kept.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const needsCode = (status: AccountStatus) =>
    status === "code_sent" || status === "awaiting_2fa";

  const atLimit = accounts.length >= MAX_ACCOUNTS;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {accounts.length} / {MAX_ACCOUNTS} accounts
        </p>
        <Button
          onClick={() => setOpen(true)}
          disabled={atLimit}
          aria-label="Add account"
        >
          <Plus className="h-4 w-4" />
          Add account
        </Button>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No accounts yet. Add a real Telegram account to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <Card key={account.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{account.label}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {account.phone}
                      {account.username ? ` · @${account.username}` : ""}
                    </p>
                  </div>
                  <AccountStatusBadge status={account.status} />
                </div>

                {account.last_error ? (
                  <p className="line-clamp-2 text-xs text-destructive">
                    {account.last_error}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {needsCode(account.status) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => resumeLogin(account)}
                    >
                      <KeyRound className="h-4 w-4" />
                      Enter code
                    </Button>
                  ) : null}
                  {(account.status === "offline" ||
                    account.status === "error" ||
                    account.status === "new") &&
                  account.session_enc == null ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => reconnect(account)}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Resend code
                    </Button>
                  ) : null}
                  {account.status === "online" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => disconnect(account)}
                    >
                      <Power className="h-4 w-4" />
                      Disconnect
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(account)}
                    aria-label="Remove account"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect a Telegram account</DialogTitle>
            <DialogDescription>
              Logs in as a real user via Telegram&apos;s MTProto API. The login
              code is sent to the phone&apos;s Telegram app.
            </DialogDescription>
          </DialogHeader>

          {step === "details" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  placeholder="e.g. Warrior 1"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone (with country code)</Label>
                <Input
                  id="phone"
                  placeholder="+15551234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={handleStartLogin}
                disabled={busy}
              >
                {busy ? "Sending code..." : "Send login code"}
              </Button>
            </div>
          ) : null}

          {step === "code" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Login code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  placeholder="12345"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Check the Telegram app on {phone} for the code.
                </p>
              </div>
              <Button
                className="w-full"
                onClick={handleSubmitCode}
                disabled={busy}
              >
                {busy ? "Verifying..." : "Verify code"}
              </Button>
            </div>
          ) : null}

          {step === "2fa" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Two-factor password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={handleSubmit2fa}
                disabled={busy}
              >
                {busy ? "Verifying..." : "Verify password"}
              </Button>
            </div>
          ) : null}

          {step === "done" ? (
            <div className="space-y-4">
              <p className="text-sm">
                Account connected and ready to join conversations.
              </p>
              <Button className="w-full" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};
