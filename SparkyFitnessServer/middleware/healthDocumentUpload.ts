// @ts-expect-error TS(7016): Could not find a declaration file for module 'multer'
import multer from 'multer';
import path from 'path';
import { HEALTH_DOCUMENT_MAX_BYTES } from '@workspace/shared';

/**
 * Buffers one report file in memory so its real bytes can be checked before anything is written
 * to disk. The filter below only looks at the name and type the browser sent, both of which can
 * be made up; the route decides from the bytes (detectHealthDocumentType).
 */
const ALLOWED_EXTENSIONS = /^\.(pdf|jpe?g|png|gif|webp)$/;
const healthDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HEALTH_DOCUMENT_MAX_BYTES, files: 1 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fileFilter: (_req: any, file: any, cb: any) => {
    if (ALLOWED_EXTENSIONS.test(path.extname(file.originalname).toLowerCase()))
      cb(null, true);
    else cb(new Error('Upload a PDF or an image (jpeg, png, webp or gif).'));
  },
});
export default healthDocumentUpload;
