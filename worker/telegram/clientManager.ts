import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { computeCheck } from "telegram/Password";
import { getPeerId } from "telegram/Utils";
import { env } from "../env";

export type GroupInfo = {
  id: string;
  title: string;
  username: string | null;
  type: "group" | "supergroup" | "channel";
};

export type LoginStartResult = { status: "code_sent" };
export type LoginCodeResult =
  | { status: "online"; sessionString: string; user: TelegramUserInfo }
  | { status: "awaiting_2fa" };
export type Login2faResult = {
  status: "online";
  sessionString: string;
  user: TelegramUserInfo;
};

export type TelegramUserInfo = {
  telegramUserId: number;
  username: string | null;
  firstName: string | null;
};

type PendingLogin = {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
};

const buildClient = (session: string): TelegramClient =>
  new TelegramClient(
    new StringSession(session),
    env.telegramApiId(),
    env.telegramApiHash(),
    { connectionRetries: 5 }
  );

const readUserInfo = async (client: TelegramClient): Promise<TelegramUserInfo> => {
  const me = await client.getMe();
  const user = me as Api.User;
  return {
    telegramUserId: Number(user.id),
    username: user.username ?? null,
    firstName: user.firstName ?? null,
  };
};

// Holds GramJS clients across the multi-step login handshake and for
// live campaign connections. Keyed by account id.
class ClientManager {
  private pendingLogins = new Map<string, PendingLogin>();
  private connected = new Map<string, TelegramClient>();
  // In-flight connects, so concurrent getClient calls for the same account
  // don't open two connections with the same session (which Telegram rejects
  // with AUTH_KEY_DUPLICATED).
  private connecting = new Map<string, Promise<TelegramClient>>();

  async startLogin(accountId: string, phone: string): Promise<LoginStartResult> {
    await this.cancelLogin(accountId);
    const client = buildClient("");
    await client.connect();
    const { phoneCodeHash } = await client.sendCode(
      { apiId: env.telegramApiId(), apiHash: env.telegramApiHash() },
      phone
    );
    this.pendingLogins.set(accountId, { client, phone, phoneCodeHash });
    return { status: "code_sent" };
  }

  async confirmCode(accountId: string, code: string): Promise<LoginCodeResult> {
    const pending = this.pendingLogins.get(accountId);
    if (!pending) throw new Error("No pending login. Start the login first.");

    try {
      await pending.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: pending.phone,
          phoneCodeHash: pending.phoneCodeHash,
          phoneCode: code,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("SESSION_PASSWORD_NEEDED")) {
        return { status: "awaiting_2fa" };
      }
      throw err;
    }

    return this.finishLogin(accountId, pending.client);
  }

  async confirm2fa(accountId: string, password: string): Promise<Login2faResult> {
    const pending = this.pendingLogins.get(accountId);
    if (!pending) throw new Error("No pending login. Start the login first.");

    const passwordInfo = await pending.client.invoke(
      new Api.account.GetPassword()
    );
    const srp = await computeCheck(passwordInfo, password);
    await pending.client.invoke(new Api.auth.CheckPassword({ password: srp }));

    return this.finishLogin(accountId, pending.client);
  }

  private async finishLogin(
    accountId: string,
    client: TelegramClient
  ): Promise<Login2faResult> {
    const user = await readUserInfo(client);
    const sessionString = String(client.session.save());
    this.pendingLogins.delete(accountId);
    this.connected.set(accountId, client);
    return { status: "online", sessionString, user };
  }

  async cancelLogin(accountId: string): Promise<void> {
    const pending = this.pendingLogins.get(accountId);
    if (!pending) return;
    try {
      await pending.client.disconnect();
    } catch {
      // ignore
    }
    this.pendingLogins.delete(accountId);
  }

  // Returns a connected client for a logged-in account, reusing if possible.
  async getClient(
    accountId: string,
    sessionString: string
  ): Promise<TelegramClient> {
    const existing = this.connected.get(accountId);
    if (existing && existing.connected) return existing;

    // Coalesce concurrent connects for the same account.
    const inflight = this.connecting.get(accountId);
    if (inflight) return inflight;

    const connectPromise = (async () => {
      const client = buildClient(sessionString);
      try {
        await client.connect();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("AUTH_KEY_DUPLICATED")) {
          throw new Error(
            "This account's Telegram session is active from another location " +
              "(usually another worker running the same account, e.g. a local " +
              "worker and the Railway worker at once). Stop the other worker, " +
              "then re-login this account under Accounts. (AUTH_KEY_DUPLICATED)"
          );
        }
        throw err;
      }
      this.connected.set(accountId, client);
      return client;
    })();

    this.connecting.set(accountId, connectPromise);
    try {
      return await connectPromise;
    } finally {
      this.connecting.delete(accountId);
    }
  }

  // Lists the groups/channels the account belongs to, for ID lookup.
  async listGroups(
    accountId: string,
    sessionString: string
  ): Promise<GroupInfo[]> {
    const client = await this.getClient(accountId, sessionString);
    const dialogs = await client.getDialogs({ limit: 300 });
    const groups: GroupInfo[] = [];

    for (const dialog of dialogs) {
      if (!dialog.isGroup && !dialog.isChannel) continue;
      const entity = dialog.entity;
      if (!entity) continue;

      let type: GroupInfo["type"] = "group";
      let username: string | null = null;
      if (entity instanceof Api.Channel) {
        type = entity.megagroup ? "supergroup" : "channel";
        username = entity.username ?? null;
      }

      groups.push({
        id: getPeerId(entity, true),
        title: dialog.title || dialog.name || "Untitled",
        username,
        type,
      });
    }

    return groups;
  }

  async disconnect(accountId: string): Promise<void> {
    const client = this.connected.get(accountId);
    if (!client) return;
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
    this.connected.delete(accountId);
  }

  async disconnectAll(): Promise<void> {
    for (const id of [...this.connected.keys()]) {
      await this.disconnect(id);
    }
    for (const id of [...this.pendingLogins.keys()]) {
      await this.cancelLogin(id);
    }
  }
}

export const clientManager = new ClientManager();
