import type { EcgImportOutcome } from '@workspace/shared';
import { HttpApiError } from '@/api/api';
import {
  ECG_NOT_PDF_MESSAGE,
  ECG_REQUEST_FAILED_MESSAGE,
  ECG_TOO_LARGE_MESSAGE,
  ECG_TOO_MANY_MESSAGE,
  countAdded,
  runEcgImport,
} from '@/hooks/Labs/ecgImportModel';

const pdf = (name: string, size = 100) => {
  const file = new File(['x'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};
const ok = (file: File): Promise<EcgImportOutcome> =>
  Promise.resolve({ file: file.name, status: 'imported', message: 'Added.' });

describe('runEcgImport', () => {
  it('sends one request per file, in order, reporting each as it lands', async () => {
    const order: string[] = [];
    const seen: string[] = [];
    const send = jest.fn(async (file: File) => {
      order.push(file.name);
      return ok(file);
    });
    const result = await runEcgImport(
      [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')],
      send,
      (o) => seen.push(`${o.file}@${order.length}`)
    );
    expect(send).toHaveBeenCalledTimes(3);
    expect(order).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    // Each outcome was reported before the next file was sent.
    expect(seen).toEqual(['a.pdf@1', 'b.pdf@2', 'c.pdf@3']);
    expect(result.error).toBeNull();
    expect(result.outcomes).toHaveLength(3);
  });

  it('does not wait for the next file before reporting the previous one', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const reported: string[] = [];
    const send = jest.fn(async (file: File) => {
      if (file.name === 'b.pdf') await gate;
      return ok(file);
    });
    const run = runEcgImport([pdf('a.pdf'), pdf('b.pdf')], send, (o) =>
      reported.push(o.file)
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(reported).toEqual(['a.pdf']);
    release();
    await run;
    expect(reported).toEqual(['a.pdf', 'b.pdf']);
  });

  it('refuses more than 25 files and sends nothing', async () => {
    const send = jest.fn(ok);
    const files = Array.from({ length: 26 }, (_, i) => pdf(`${i}.pdf`));
    const result = await runEcgImport(files, send, jest.fn());
    expect(result.error).toBe('Import at most 25 reports at a time.');
    expect(result.error).toBe(ECG_TOO_MANY_MESSAGE);
    expect(send).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([]);
  });

  it('accepts exactly 25 files', async () => {
    const send = jest.fn(ok);
    const files = Array.from({ length: 25 }, (_, i) => pdf(`${i}.pdf`));
    const result = await runEcgImport(files, send, jest.fn());
    expect(result.error).toBeNull();
    expect(send).toHaveBeenCalledTimes(25);
  });

  it('turns an oversize file into a failed outcome without sending it', async () => {
    const send = jest.fn(ok);
    const result = await runEcgImport(
      [pdf('big.pdf', 10 * 1024 * 1024 + 1), pdf('fine.pdf', 10 * 1024 * 1024)],
      send,
      jest.fn()
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].name).toBe('fine.pdf');
    expect(result.outcomes[0]).toEqual({
      file: 'big.pdf',
      status: 'failed',
      message: 'This file is larger than 10 MB.',
    });
    expect(result.outcomes[0]!.message).toBe(ECG_TOO_LARGE_MESSAGE);
  });

  it('turns a non-PDF into a failed outcome without sending it', async () => {
    const send = jest.fn(ok);
    const png = new File(['x'], 'photo.png', { type: 'image/png' });
    const result = await runEcgImport([png, pdf('a.pdf')], send, jest.fn());
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.outcomes[0]).toMatchObject({
      file: 'photo.png',
      status: 'failed',
      message: ECG_NOT_PDF_MESSAGE,
    });
  });

  it('takes a .pdf name even when the browser gives no type', async () => {
    const send = jest.fn(ok);
    await runEcgImport([new File(['x'], 'Report.PDF')], send, jest.fn());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('records a failed request as that file failing and carries on', async () => {
    const send = jest.fn(async (file: File) => {
      if (file.name === 'b.pdf')
        throw new HttpApiError('Payload too large', 413);
      if (file.name === 'c.pdf') throw new Error('network down');
      return ok(file);
    });
    const result = await runEcgImport(
      [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'), pdf('d.pdf')],
      send,
      jest.fn()
    );
    expect(send).toHaveBeenCalledTimes(4);
    expect(result.outcomes.map((o) => [o.file, o.status])).toEqual([
      ['a.pdf', 'imported'],
      ['b.pdf', 'failed'],
      ['c.pdf', 'failed'],
      ['d.pdf', 'imported'],
    ]);
    expect(result.outcomes[1]!.message).toBe('This file is larger than 10 MB.');
    expect(result.outcomes[2]!.message).toBe(ECG_REQUEST_FAILED_MESSAGE);
  });

  it("keeps the server's words for another HTTP failure", async () => {
    const send = jest.fn(async () => {
      throw new HttpApiError('Server is busy', 503);
    });
    const result = await runEcgImport([pdf('a.pdf')], send, jest.fn());
    expect(result.outcomes[0]!.message).toBe('Server is busy');
  });
});

describe('countAdded', () => {
  it('counts imported and updated only', () => {
    const o = (status: EcgImportOutcome['status']): EcgImportOutcome => ({
      file: 'x',
      status,
      message: '',
    });
    expect(
      countAdded([o('imported'), o('updated'), o('duplicate'), o('failed')])
    ).toBe(2);
  });
});
