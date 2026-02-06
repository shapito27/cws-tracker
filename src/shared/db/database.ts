/**
 * CWSDatabase - Dexie.js database wrapper for CWS Tracker.
 *
 * All IndexedDB access goes through this class. Never use raw indexedDB.open().
 * Dexie handles schema migrations via version(N).stores({...}).
 *
 * Index conventions (from type annotations):
 *   ++id       = auto-increment primary key
 *   id         = explicit string primary key (Extension uses CWS 32-char ID)
 *   [a+b]      = compound index
 *   field      = simple index
 */

import Dexie, { type Table } from 'dexie';
import type {
  Project,
  Extension,
  Keyword,
  ListingSnapshot,
  RankSnapshot,
  EventRecord,
  QueueJob,
  TranslationSnapshot,
  QueueJobStatus,
} from '../types';
import type { CachedAuditResult } from '../utils/keyword-audit';

export class CWSDatabase extends Dexie {
  projects!: Table<Project, number>;
  extensions!: Table<Extension, string>;
  keywords!: Table<Keyword, number>;
  listing_snapshots!: Table<ListingSnapshot, number>;
  rank_snapshots!: Table<RankSnapshot, number>;
  events!: Table<EventRecord, number>;
  queue!: Table<QueueJob, number>;
  translation_snapshots!: Table<TranslationSnapshot, number>;
  audit_cache!: Table<CachedAuditResult, number>;

  constructor(name = 'CWSTrackerDB') {
    super(name);

    this.version(1).stores({
      projects: '++id',
      extensions: 'id',
      keywords: '++id, projectId',
      listing_snapshots: '++id, [extensionId+date], extensionId',
      rank_snapshots: '++id, [keywordId+extensionId+date], [extensionId+date]',
      events: '++id, [extensionId+date]',
      queue: '++id, [status+scheduledAt], status',
      translation_snapshots: '++id, [extensionId+date]',
    });

    // v2: Add audit_cache table for AI keyword audit results
    this.version(2).stores({
      audit_cache: '++id, cacheKey',
    });
  }

  // ---------------------------------------------------------------------------
  // Project methods
  // ---------------------------------------------------------------------------

  async getProject(id: number): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async getAllProjects(): Promise<Project[]> {
    return this.projects.toArray();
  }

  async saveProject(project: Project): Promise<number> {
    return this.projects.put(project);
  }

  async deleteProject(id: number): Promise<void> {
    await this.projects.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Extension methods
  // ---------------------------------------------------------------------------

  async getExtension(id: string): Promise<Extension | undefined> {
    return this.extensions.get(id);
  }

  async saveExtension(extension: Extension): Promise<string> {
    return this.extensions.put(extension);
  }

  async deleteExtension(id: string): Promise<void> {
    await this.extensions.delete(id);
  }

  async getOrphanedExtensions(): Promise<Extension[]> {
    return this.extensions
      .filter((ext) => ext.projectRefs.length === 0)
      .toArray();
  }

  // ---------------------------------------------------------------------------
  // Keyword methods
  // ---------------------------------------------------------------------------

  async getKeywordsByProject(projectId: number): Promise<Keyword[]> {
    return this.keywords.where('projectId').equals(projectId).toArray();
  }

  async saveKeyword(keyword: Keyword): Promise<number> {
    return this.keywords.put(keyword);
  }

  async deleteKeyword(id: number): Promise<void> {
    await this.keywords.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Listing snapshot methods
  // ---------------------------------------------------------------------------

  async getListingSnapshots(
    extensionId: string,
    startDate: string,
    endDate: string
  ): Promise<ListingSnapshot[]> {
    return this.listing_snapshots
      .where('[extensionId+date]')
      .between([extensionId, startDate], [extensionId, endDate], true, true)
      .toArray();
  }

  async getLatestListingSnapshot(
    extensionId: string
  ): Promise<ListingSnapshot | undefined> {
    const results = await this.listing_snapshots
      .where('extensionId')
      .equals(extensionId)
      .reverse()
      .sortBy('date');
    return results[0];
  }

  async saveListingSnapshot(snapshot: ListingSnapshot): Promise<number> {
    return this.listing_snapshots.put(snapshot);
  }

  // ---------------------------------------------------------------------------
  // Rank snapshot methods
  // ---------------------------------------------------------------------------

  async getRankSnapshots(
    keywordId: number,
    extensionId: string,
    startDate: string,
    endDate: string
  ): Promise<RankSnapshot[]> {
    return this.rank_snapshots
      .where('[keywordId+extensionId+date]')
      .between(
        [keywordId, extensionId, startDate],
        [keywordId, extensionId, endDate],
        true,
        true
      )
      .toArray();
  }

  async getLatestRankForKeyword(
    keywordId: number
  ): Promise<RankSnapshot[]> {
    // Prefix query on compound index [keywordId+extensionId+date].
    // Use '' as lower bound and '\uffff' as upper bound for string fields
    // since Dexie.minKey/maxKey are not supported by fake-indexeddb in compounds.
    const all = await this.rank_snapshots
      .where('[keywordId+extensionId+date]')
      .between(
        [keywordId, '', ''],
        [keywordId, '\uffff', '\uffff']
      )
      .toArray();

    if (all.length === 0) return [];

    // Find the latest date among all snapshots for this keyword
    const latestDate = all.reduce(
      (max, s) => (s.date > max ? s.date : max),
      all[0].date
    );

    return all.filter((s) => s.date === latestDate);
  }

  async saveRankSnapshots(snapshots: RankSnapshot[]): Promise<void> {
    await this.transaction('rw', this.rank_snapshots, async () => {
      await this.rank_snapshots.bulkPut(snapshots);
    });
  }

  // ---------------------------------------------------------------------------
  // Event methods
  // ---------------------------------------------------------------------------

  async getEvents(
    extensionId: string,
    startDate: string,
    endDate: string
  ): Promise<EventRecord[]> {
    return this.events
      .where('[extensionId+date]')
      .between([extensionId, startDate], [extensionId, endDate], true, true)
      .toArray();
  }

  async getRecentEvents(limit: number): Promise<EventRecord[]> {
    return this.events.orderBy('id').reverse().limit(limit).toArray();
  }

  async saveEvent(event: EventRecord): Promise<number> {
    return this.events.put(event);
  }

  // ---------------------------------------------------------------------------
  // Queue methods
  // ---------------------------------------------------------------------------

  async enqueueJobs(jobs: QueueJob[]): Promise<void> {
    await this.queue.bulkAdd(jobs);
  }

  async dequeueNext(): Promise<QueueJob | null> {
    const now = new Date();
    return this.transaction('rw', this.queue, async () => {
      // Find the pending job with earliest scheduledAt that is not in the future
      const pending = await this.queue
        .where('[status+scheduledAt]')
        .between(['pending', Dexie.minKey], ['pending', now], true, true)
        .toArray();

      if (pending.length === 0) return null;

      // Sort by priority (lowest number = highest priority), then by scheduledAt
      pending.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.scheduledAt.getTime() - b.scheduledAt.getTime();
      });

      const job = pending[0];
      const startedAt = new Date();
      await this.queue.update(job.id!, { status: 'running' as QueueJobStatus, startedAt });
      return { ...job, status: 'running' as QueueJobStatus, startedAt };
    });
  }

  async updateJobStatus(
    id: number,
    status: QueueJobStatus,
    error?: string
  ): Promise<void> {
    const updates: Partial<QueueJob> = { status };
    if (status === 'completed' || status === 'failed') {
      updates.completedAt = new Date();
    }
    if (error !== undefined) {
      updates.error = error;
    }
    await this.queue.update(id, updates);
  }

  async getRunningJobs(): Promise<QueueJob[]> {
    return this.queue.where('status').equals('running').toArray();
  }

  async resetRunningJobs(): Promise<number> {
    const running = await this.queue.where('status').equals('running').toArray();
    const ids = running.map((j) => j.id!);
    if (ids.length === 0) return 0;
    await this.queue
      .where('id')
      .anyOf(ids)
      .modify({ status: 'pending' as QueueJobStatus, startedAt: null });
    return ids.length;
  }

  async getPendingCount(): Promise<number> {
    return this.queue.where('status').equals('pending').count();
  }

  async getQueueStats(): Promise<Record<QueueJobStatus, number>> {
    const all = await this.queue.toArray();
    const stats: Record<QueueJobStatus, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
    };
    for (const job of all) {
      stats[job.status]++;
    }
    return stats;
  }

  async cleanupOldJobs(
    completedBeforeDate: Date,
    failedBeforeDate: Date
  ): Promise<number> {
    let count = 0;
    await this.transaction('rw', this.queue, async () => {
      const toDelete = await this.queue.filter((job) => {
        if (job.status === 'completed' && job.completedAt && job.completedAt < completedBeforeDate) {
          return true;
        }
        if (job.status === 'failed' && job.completedAt && job.completedAt < failedBeforeDate) {
          return true;
        }
        return false;
      }).toArray();
      const ids = toDelete.map((j) => j.id!);
      if (ids.length > 0) {
        await this.queue.bulkDelete(ids);
      }
      count = ids.length;
    });
    return count;
  }

  // ---------------------------------------------------------------------------
  // Audit cache methods
  // ---------------------------------------------------------------------------

  async getCachedAudit(cacheKey: string): Promise<CachedAuditResult | undefined> {
    return this.audit_cache.where('cacheKey').equals(cacheKey).first();
  }

  async saveAuditResult(result: CachedAuditResult): Promise<number> {
    return this.audit_cache.put(result);
  }

  async clearAuditCache(): Promise<void> {
    await this.audit_cache.clear();
  }

  // ---------------------------------------------------------------------------
  // Bulk data management
  // ---------------------------------------------------------------------------

  async deleteExtensionData(extensionId: string): Promise<void> {
    await this.transaction(
      'rw',
      [this.listing_snapshots, this.rank_snapshots, this.events, this.translation_snapshots],
      async () => {
        await this.listing_snapshots.where('extensionId').equals(extensionId).delete();
        await this.rank_snapshots.where('[extensionId+date]')
          .between([extensionId, Dexie.minKey], [extensionId, Dexie.maxKey])
          .delete();
        await this.events.where('[extensionId+date]')
          .between([extensionId, Dexie.minKey], [extensionId, Dexie.maxKey])
          .delete();
        await this.translation_snapshots.where('[extensionId+date]')
          .between([extensionId, Dexie.minKey], [extensionId, Dexie.maxKey])
          .delete();
      }
    );
  }

  async pruneOldSnapshots(beforeDate: string): Promise<void> {
    await this.transaction(
      'rw',
      [this.listing_snapshots, this.rank_snapshots, this.translation_snapshots],
      async () => {
        // For listing_snapshots: filter by date field
        const oldListings = await this.listing_snapshots
          .filter((s) => s.date < beforeDate)
          .toArray();
        if (oldListings.length > 0) {
          await this.listing_snapshots.bulkDelete(oldListings.map((s) => s.id!));
        }

        // For rank_snapshots: filter by date field
        const oldRanks = await this.rank_snapshots
          .filter((s) => s.date < beforeDate)
          .toArray();
        if (oldRanks.length > 0) {
          await this.rank_snapshots.bulkDelete(oldRanks.map((s) => s.id!));
        }

        // For translation_snapshots: filter by date field
        const oldTranslations = await this.translation_snapshots
          .filter((s) => s.date < beforeDate)
          .toArray();
        if (oldTranslations.length > 0) {
          await this.translation_snapshots.bulkDelete(oldTranslations.map((s) => s.id!));
        }
      }
    );
  }
}

/** Singleton database instance for the application. */
export const db = new CWSDatabase();
