import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import {
  detectHealthDocumentType,
  type HealthDocument,
  type HealthDocumentFields,
} from '@workspace/shared';
import { log } from '../config/logging.js';
import {
  deleteHealthDocument,
  getHealthDocumentFile,
  insertHealthDocument,
} from '../models/healthDocumentRepository.js';
import {
  resolveUploadPath,
  resolveUploadPathWithinRoot,
} from '../utils/uploadsPath.js';

const fail = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode, status: statusCode });

const safeUnlink = async (absolutePath: string) => {
  try {
    await fs.promises.unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      log(
        'warn',
        `Failed to remove health document file ${absolutePath}`,
        error
      );
  }
};

/** The name the file came with, without any folders or control characters, kept short. */
export function cleanDocumentName(
  name: string | undefined,
  ext: string
): string {
  const base = path
    .basename((name ?? '').replace(/\\/g, '/'))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200);
  return base || `document.${ext}`;
}

/**
 * Keeps an uploaded file: checks what it really is, refuses a copy of one already stored, writes
 * it under the uploads folder and records it. The file is written aside first and moved into
 * place only once the record is saved, so a failed save leaves nothing behind.
 */
export async function storeHealthDocument(
  owner: string,
  file: { buffer: Buffer; originalname?: string },
  fields: HealthDocumentFields,
  authenticatedUserId?: string
): Promise<HealthDocument> {
  const type = detectHealthDocumentType(file.buffer);
  if (!type)
    throw fail('Upload a PDF or an image (jpeg, png, webp or gif).', 400);
  const id = randomUUID();
  const relativePath = path.join(
    'uploads',
    'health-documents',
    owner,
    `${id}.${type.ext}`
  );
  const finalPath = resolveUploadPath(relativePath);
  const tempPath = `${finalPath}.tmp-${randomUUID()}`;
  await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.promises.writeFile(tempPath, file.buffer);
  try {
    const stored = await insertHealthDocument(
      owner,
      {
        id,
        fields,
        original_name: cleanDocumentName(file.originalname, type.ext),
        mime: type.mime,
        size_bytes: file.buffer.length,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        file_path: relativePath,
      },
      authenticatedUserId
    );
    try {
      await fs.promises.rename(tempPath, finalPath);
    } catch (error) {
      // The record points at a file that is not there: take the record back out.
      await deleteHealthDocument(owner, id, authenticatedUserId).catch(
        () => undefined
      );
      throw error;
    }
    return stored;
  } catch (error) {
    await safeUnlink(tempPath);
    throw error;
  }
}

/** The file of a stored original, if it is the owner's and still on disk. */
export async function openHealthDocument(
  owner: string,
  id: string,
  authenticatedUserId?: string
): Promise<{ absolute: string; original_name: string; mime: string } | null> {
  const meta = await getHealthDocumentFile(owner, id, authenticatedUserId);
  if (!meta) return null;
  // A stored path that leaves the uploads folder is never served.
  const absolute = resolveUploadPathWithinRoot(meta.file_path);
  if (!absolute) {
    log(
      'warn',
      `Rejected health document path outside uploads root: ${meta.file_path}`
    );
    return null;
  }
  try {
    await fs.promises.access(absolute);
  } catch {
    return null;
  }
  return { absolute, original_name: meta.original_name, mime: meta.mime };
}

/** Removes a stored file by the path its row held, unless that path leaves the uploads folder. */
export async function discardHealthDocumentFile(
  filePath: string
): Promise<void> {
  const absolute = resolveUploadPathWithinRoot(filePath);
  if (!absolute) {
    log(
      'warn',
      `Refused to delete health document path outside uploads root: ${filePath}`
    );
    return;
  }
  await safeUnlink(absolute);
}

/** Deletes a stored original and its file. A document already gone counts as deleted. */
export async function removeHealthDocument(
  owner: string,
  id: string,
  authenticatedUserId?: string
): Promise<void> {
  const filePath = await deleteHealthDocument(owner, id, authenticatedUserId);
  if (!filePath) return;
  await discardHealthDocumentFile(filePath);
}
