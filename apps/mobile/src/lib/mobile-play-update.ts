import type { GooglePlayUpdateResult, GooglePlayUpdateState } from "../../modules/edgeever-app-store";

type PlayUpdateApi = {
  check: () => Promise<GooglePlayUpdateState>;
  start: () => Promise<GooglePlayUpdateResult>;
};

type PlayUpdateOffer = (versionCode: number) => Promise<unknown>;

/** Owns Play consent and state recovery independently of GitHub release availability. */
export class MobilePlayUpdate {
  state: GooglePlayUpdateState = { status: "unavailable", versionCode: 0 };
  hasKnownUpdate = false;
  private promptedVersions = new Set<number>();
  private offering = false;
  private starting: Promise<GooglePlayUpdateResult> | null = null;
  private revision = 0;

  constructor(private api: PlayUpdateApi, private onState: (state: GooglePlayUpdateState) => void) {}

  receive = (state: GooglePlayUpdateState) => {
    this.revision += 1;
    this.state = state;
    if (state.status !== "unavailable") this.hasKnownUpdate = true;
    this.onState(state);
  };

  async check(showOffer?: PlayUpdateOffer): Promise<boolean> {
    const revision = this.revision;
    const state = await this.api.check();
    // An install event received during the request is more recent than its snapshot.
    if (revision === this.revision) this.receive(state);
    if (showOffer && !this.promptedVersions.has(this.state.versionCode)) await this.offer(showOffer);
    return this.state.status !== "unavailable";
  }

  async offer(showOffer: PlayUpdateOffer): Promise<void> {
    if (this.offering || this.starting || this.state.status !== "available") return;
    this.offering = true;
    this.promptedVersions.add(this.state.versionCode);
    try {
      await showOffer(this.state.versionCode);
    } finally {
      this.offering = false;
    }
  }

  start(): Promise<GooglePlayUpdateResult> {
    if (this.starting) return this.starting;
    this.promptedVersions.add(this.state.versionCode);
    const revision = this.revision;
    this.starting = this.api.start().then((result) => {
      if (result === "unavailable") {
        this.receive({ ...this.state, status: "unavailable" });
      } else if (result === "accepted" && revision === this.revision) {
        this.receive({ ...this.state, status: "downloading" });
      }
      return result;
    }).finally(() => { this.starting = null; });
    return this.starting;
  }
}
