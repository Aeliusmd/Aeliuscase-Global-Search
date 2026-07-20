type DocumentWithId = {
  _id: string;
  [key: string]: unknown;
};

type IndexRecord = {
  keys: Record<string, number>;
  options: Record<string, unknown>;
};

function matches(document: DocumentWithId, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, criterion]) => {
    if (
      criterion
      && typeof criterion === 'object'
      && '$gt' in criterion
      && criterion.$gt instanceof Date
    ) {
      const value = document[key];
      return value instanceof Date && value.getTime() > criterion.$gt.getTime();
    }
    return document[key] === criterion;
  });
}

export class InMemoryCollection<T extends DocumentWithId> {
  readonly documents = new Map<string, T>();
  readonly indexes: IndexRecord[] = [];

  async createIndex(
    keys: Record<string, number>,
    options: Record<string, unknown>,
  ): Promise<string> {
    this.indexes.push({ keys, options });
    return Object.entries(keys).map(([key, direction]) => `${key}_${direction}`).join('_');
  }

  async insertOne(document: T): Promise<{ acknowledged: true; insertedId: string }> {
    if (this.documents.has(document._id)) throw new Error('Duplicate key');
    this.documents.set(document._id, { ...document });
    return { acknowledged: true, insertedId: document._id };
  }

  async findOne(filter: Record<string, unknown>): Promise<T | null> {
    const document = [...this.documents.values()].find((item) => matches(item, filter));
    return document ? { ...document } : null;
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: { $set?: Partial<T> },
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const document = [...this.documents.values()].find((item) => matches(item, filter));
    if (!document) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(document, update.$set ?? {});
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }> {
    const document = [...this.documents.values()].find((item) => matches(item, filter));
    if (!document) return { deletedCount: 0 };
    this.documents.delete(document._id);
    return { deletedCount: 1 };
  }

  async findOneAndUpdate(
    filter: { _id: string },
    update: {
      $inc?: Record<string, number>;
      $setOnInsert?: Record<string, unknown>;
    },
    options: { upsert?: boolean; returnDocument?: 'after' | 'before' },
  ): Promise<T | null> {
    let document = this.documents.get(filter._id);
    if (!document && options.upsert) {
      document = {
        _id: filter._id,
        ...(update.$setOnInsert ?? {}),
      } as T;
      this.documents.set(filter._id, document);
    }
    if (!document) return null;

    for (const [key, increment] of Object.entries(update.$inc ?? {})) {
      const current = typeof document[key] === 'number' ? document[key] : 0;
      document[key] = current + increment;
    }
    return options.returnDocument === 'before' ? null : { ...document };
  }

  clear(): void {
    this.documents.clear();
  }
}

export class InMemoryDb {
  private readonly collections = new Map<string, InMemoryCollection<DocumentWithId>>();

  collection<T extends DocumentWithId>(name: string): InMemoryCollection<T> {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new InMemoryCollection<DocumentWithId>();
      this.collections.set(name, collection);
    }
    return collection as InMemoryCollection<T>;
  }

  clear(): void {
    for (const collection of this.collections.values()) collection.clear();
  }
}
