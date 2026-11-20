import type { GooglePlayUpdateResult, GooglePlayUpdateState } from "../../modules/edgeever-app-store";

type PlayUpdateApi = {
  check: () => Promise<GooglePlayUpdateState>;
  start: () => Promise<GooglePlayUpdateResult>;
};

/** Owns Play consent and state recovery independently of GitHub release availability. */
export class MobilePlayUpdate {
  state: GooglePlayUpdateState = { status: "unavailable", versionCode: 0 };
  hasKnownUpdate = false;
  private promptedVersions = new Set<number>();
  private starting = false;
  private revision = 0;

  constructor(private api: PlayUpdateApi, private onState: (state: GooglePlayUpdateState) => void) {}

  receive = (state: GooglePlayUpdateState) => {
    this.revision += 1;
    this.state = state;
    if (state.status !== "unavailable") this.hasKnownUpdate = true;
    this.onState(state);
  };

  async check(canPrompt?: () => boolean): Promise<boolean> {
    const revision = this.revision;
    const state = await this.api.check();
    // An install event received during the request is more recent than its snapshot.
    if (revision === this.revision) this.receive(state);
    if (canPrompt?.() && !this.promptedVersions.has(this.state.versionCode)) await this.start();
    return this.state.status !== "unavailable";
  }

  async start(): Promise<GooglePlayUpdateResult | undefined> {
    if (this.starting || this.state.status !== "available") return;
    this.starting = true;
    this.promptedVersions.add(this.state.versionCode);
    const revision = this.revision;
    try {
      const result = await this.api.start();
      if (result === "unavailable") {
        this.receive({ ...this.state, status: "unavailable" });
      } else if (result === "accepted" && revision === this.revision) {
        this.receive({ ...this.state, status: "downloading" });
      }
      return result;
    } finally {
      this.starting = false;
    }
  }
}
