import { writable } from 'svelte/store';

const DB_NAME = 'LomifyMobilePlaylistCovers';
const STORE_NAME = 'covers';
const COVER_SIZE = 512;

interface StoredCover { id: string; blob: Blob }

export const mobilePlaylistCoverUrls = writable<Record<string, string>>({});

let databasePromise: Promise<IDBDatabase> | null = null;
let loadingPromise: Promise<void> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    }).catch(error => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise!;
}

export function loadMobilePlaylistCovers(): Promise<void> {
  if (!loadingPromise) {
    loadingPromise = (async () => {
      const db = await openDatabase();
      const records = await new Promise<StoredCover[]>((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result as StoredCover[]);
        request.onerror = () => reject(request.error);
      });
      const urls: Record<string, string> = {};
      for (const record of records) {
        if (record?.id && record.blob instanceof Blob) urls[record.id] = URL.createObjectURL(record.blob);
      }
      mobilePlaylistCoverUrls.set(urls);
    })().catch(error => {
      loadingPromise = null;
      throw error;
    });
  }
  return loadingPromise;
}

function writeCover(id: string, blob?: Blob): Promise<void> {
  return openDatabase().then(db => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    if (blob) store.put({ id, blob } satisfies StoredCover);
    else store.delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

export async function setMobilePlaylistCover(id: string, blob: Blob): Promise<void> {
  await loadMobilePlaylistCovers();
  await writeCover(id, blob);
  const url = URL.createObjectURL(blob);
  mobilePlaylistCoverUrls.update(current => {
    if (current[id]) URL.revokeObjectURL(current[id]);
    return { ...current, [id]: url };
  });
}

export async function removeMobilePlaylistCover(id: string): Promise<void> {
  await loadMobilePlaylistCovers();
  await writeCover(id);
  mobilePlaylistCoverUrls.update(current => {
    if (!current[id]) return current;
    URL.revokeObjectURL(current[id]);
    const next = { ...current };
    delete next[id];
    return next;
  });
}

export async function prepareMobilePlaylistCover(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) {
    throw new Error('Поддерживаются JPG, PNG, WebP и AVIF.');
  }
  if (file.size > 15 * 1024 * 1024) throw new Error('Изображение больше 15 МБ. Выбери файл поменьше.');

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Не удалось открыть изображение. Попробуй JPG или PNG.'));
      image.src = sourceUrl;
    });
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height || width * height > 36_000_000) {
      throw new Error('Размер изображения не поддерживается. Выбери другое.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = COVER_SIZE;
    canvas.height = COVER_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить обложку на этом устройстве.');
    context.fillStyle = '#1b1921';
    context.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
    const crop = Math.min(width, height);
    context.drawImage(image, (width - crop) / 2, (height - crop) / 2, crop, crop, 0, 0, COVER_SIZE, COVER_SIZE);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('Не удалось сохранить обложку.')), 'image/jpeg', 0.82);
    });
    return blob;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
