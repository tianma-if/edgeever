import type { Context } from "hono";
import type { CloudflareStorageBindings } from "./cloudflare-storage-adapter";
import type { StorageAdapter } from "./storage-contract";

export type Bindings = {
  /** The only persistence dependency exposed to application code. */
  storage: StorageAdapter;
  EDGE_EVER_AUTH_USERNAME?: string;
  EDGE_EVER_RUNTIME?: string;
  EDGE_EVER_CONTAINER_IMAGE?: string;
  EDGE_EVER_AUTH_PASSWORD?: string;
  EDGE_EVER_AUTH_PASSWORD_HASH?: string;
  EDGE_EVER_SESSION_TTL_DAYS?: string;
  EDGE_EVER_AUTH_LOGIN_WINDOW_SECONDS?: string;
  EDGE_EVER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS?: string;
  EDGE_EVER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS?: string;
  EDGE_EVER_AUTH_LOGIN_IP_MAX_ATTEMPTS?: string;
  EDGE_EVER_AUTH_LOGIN_IP_COOLDOWN_SECONDS?: string;
  EDGE_EVER_R2_BUCKET_NAME?: string;
  EDGE_EVER_STORAGE_ENCRYPTION_KEY?: string;
  EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY?: string;
  EDGE_EVER_DEMO_MODE?: string;
  EDGE_EVER_LOCAL_DEMO_SEED?: string;
  EDGE_EVER_ALLOW_UNAUTHENTICATED?: string;
};

export type WorkerBindings = Omit<Bindings, "storage"> & CloudflareStorageBindings;

export type AuthContext = {
  kind: "user" | "agent";
  actorType: "user" | "agent";
  actorId: string | null;
  username: string;
  displayName: string | null;
  scopes: string[];
  workspaceId: string;
  role: "owner" | "member";
  sessionId?: string;
  tokenId?: string;
};

export type AuditActor = {
  actorType: "user" | "agent";
  actorId: string | null;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    auth: AuthContext;
  };
};

export type AppContext = Context<AppEnv>;
