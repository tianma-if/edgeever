import Foundation
import Observation

@Observable
@MainActor
final class AppEnvironment {
    let session: SessionStore
    let mirror: LocalMirrorRepository
    let outbox: SyncOutboxRepository
    let drafts: DraftRepository
    let syncEngine: SyncEngine
    let outboxFlusher: OutboxFlusher
    let preferences: PreferencesStore
    let shareHandoff: ShareHandoffStore

    private(set) var bootstrapProgress: BootstrapProgress?
    private(set) var isSyncing = false
    private(set) var lastSyncError: String?
    private(set) var lastOutboxResult: SyncRunResult?

    init() {
        let dbQueue = try! AppDatabase.makeShared()
        let mirror = LocalMirrorRepository(dbQueue: dbQueue)
        let outbox = SyncOutboxRepository(dbQueue: dbQueue)
        let drafts = DraftRepository(dbQueue: dbQueue)
        let session = SessionStore()
        let syncEngine = SyncEngine(mirror: mirror, client: session.client)
        let flusher = OutboxFlusher(outbox: outbox, mirror: mirror, client: session.client)
        self.session = session
        self.mirror = mirror
        self.outbox = outbox
        self.drafts = drafts
        self.syncEngine = syncEngine
        self.outboxFlusher = flusher
        self.preferences = PreferencesStore()
        self.shareHandoff = ShareHandoffStore()
    }

    /// Test-friendly initializer.
    init(
        session: SessionStore,
        mirror: LocalMirrorRepository,
        outbox: SyncOutboxRepository,
        drafts: DraftRepository,
        syncEngine: SyncEngine,
        outboxFlusher: OutboxFlusher,
        preferences: PreferencesStore = PreferencesStore(),
        shareHandoff: ShareHandoffStore = ShareHandoffStore()
    ) {
        self.session = session
        self.mirror = mirror
        self.outbox = outbox
        self.drafts = drafts
        self.syncEngine = syncEngine
        self.outboxFlusher = outboxFlusher
        self.preferences = preferences
        self.shareHandoff = shareHandoff
    }

    func bootstrap() async {
        await session.bootstrap()
        if session.isSignedIn, !session.isMfaRebindRequired {
            // Surface first-sync progress before TipTap warm / network so the workspace
            // never flashes an empty-notebook state on cold start.
            if let scope = session.dataScope,
               !((try? mirror.isInitialized(scope: scope)) ?? false)
            {
                bootstrapProgress = BootstrapProgress(loadedCount: 0, totalCount: 0)
            }
            // Warm TipTap process + EditorBundle off the critical path of the first note open.
            await MainActor.run { TipTapWarmPool.warmIfNeeded() }
            await runSyncCycle()
        }
    }

    /// - Parameter force: when true, clear outbox backoff and retry error/conflict items immediately
    ///   (Android pull-to-refresh / "Sync now" parity).
    func runSyncCycle(force: Bool = false) async {
        // A restricted recovery-code session gets 403 on every business API.
        guard !session.isMfaRebindRequired else { return }
        guard let scope = session.dataScope else { return }
        isSyncing = true
        lastSyncError = nil
        defer { isSyncing = false }

        // Android parity: only surface bootstrap progress UI on the first mirror fill
        // (cursor/identity missing). Incremental sync stays quiet.
        let isInitialSync = !((try? mirror.isInitialized(scope: scope)) ?? false)
        if isInitialSync {
            bootstrapProgress = BootstrapProgress(loadedCount: 0, totalCount: 0)
        }

        do {
            _ = try await outboxFlusher.flush(scope: scope, force: force)

            let progressHandler: (@Sendable (BootstrapProgress) -> Void)?
            if isInitialSync {
                progressHandler = { [weak self] progress in
                    DispatchQueue.main.async {
                        self?.bootstrapProgress = progress
                    }
                }
            } else {
                progressHandler = nil
            }

            _ = try await syncEngine.sync(scope: scope, onBootstrapProgress: progressHandler)
            lastOutboxResult = try await outboxFlusher.flush(scope: scope, force: force)
            bootstrapProgress = nil
        } catch {
            lastSyncError = error.localizedDescription
            if isInitialSync {
                bootstrapProgress = nil
            }
        }
    }
}
