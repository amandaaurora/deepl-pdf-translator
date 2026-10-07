import { PDFDocument } from "pdf-lib";

export type PdfAnalysis = {
  pageCount: number;
  // Approximate characters of extractable text on each page. Scanned pages
  // come out as 0, so treat the total as a lower bound.
  pageChars: number[];
  totalChars: number;
};

export type Limits = { maxBytes: number; maxChars: number };

export type PlannedChunk = {
  firstPage: number; // 1-based, inclusive
  lastPage: number;
  chars: number;
  bytes: number;
  file: Blob;
};

export async function analysePdf(file: Blob): Promise<PdfAnalysis> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pageChars: number[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let chars = 0;
      for (const item of content.items) {
        if ("str" in item) chars += item.str.length + (item.hasEOL ? 1 : 0);
      }
      pageChars.push(chars);
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return {
    pageCount: pageChars.length,
    pageChars,
    totalChars: pageChars.reduce((a, b) => a + b, 0),
  };
}

// Splits pages into `n` consecutive groups of roughly equal weight.
function partition(weights: number[], n: number): [number, number][] {
  const total = weights.reduce((a, b) => a + b, 0);
  const ranges: [number, number][] = [];
  let start = 0;
  let running = 0;
  for (let i = 0; i < weights.length; i++) {
    running += weights[i];
    const groupsLeft = n - ranges.length - 1;
    const pagesLeft = weights.length - i - 1;
    const reachedTarget = running >= (total * (ranges.length + 1)) / n;
    if (groupsLeft > 0 && (reachedTarget || pagesLeft === groupsLeft)) {
      ranges.push([start, i]);
      start = i + 1;
    }
  }
  ranges.push([start, weights.length - 1]);
  return ranges;
}

/**
 * Works out the smallest number of parts the PDF has to be split into so
 * each part fits within `limits`. DeepL bills every PDF at a minimum of
 * 50,000 characters, so fewer parts means less quota spent.
 */
export async function splitPdf(
  file: Blob,
  analysis: PdfAnalysis,
  limits: Limits,
  onProgress?: (message: string) => void
): Promise<PlannedChunk[]> {
  const { pageCount, pageChars, totalChars } = analysis;
  if (file.size <= limits.maxBytes && totalChars <= limits.maxChars) {
    return [{ firstPage: 1, lastPage: pageCount, chars: totalChars, bytes: file.size, file }];
  }

  const source = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
  });

  // Weight each page by whichever limit it uses up faster.
  const bytesPerPage = file.size / pageCount;
  const weights = pageChars.map((c) =>
    Math.max(c / limits.maxChars, bytesPerPage / limits.maxBytes)
  );

  let n = Math.max(
    2,
    Math.ceil(totalChars / limits.maxChars),
    Math.ceil(file.size / limits.maxBytes)
  );

  while (n <= pageCount) {
    onProgress?.(`Trying ${n} parts…`);
    const chunks: PlannedChunk[] = [];
    let fits = true;
    for (const [from, to] of partition(weights, n)) {
      const chars = pageChars.slice(from, to + 1).reduce((a, b) => a + b, 0);
      if (chars > limits.maxChars) {
        fits = false;
        break;
      }
      const part = await PDFDocument.create();
      const indices = Array.from({ length: to - from + 1 }, (_, k) => from + k);
      for (const page of await part.copyPages(source, indices)) part.addPage(page);
      const bytes = await part.save({ useObjectStreams: true });
      if (bytes.byteLength > limits.maxBytes) {
        if (from === to) {
          throw new Error(
            `Page ${from + 1} on its own is ${(bytes.byteLength / 1e6).toFixed(1)} MB, ` +
              `over the ${(limits.maxBytes / 1e6).toFixed(1)} MB limit, so it can't be split small enough.`
          );
        }
        fits = false;
        break;
      }
      chunks.push({
        firstPage: from + 1,
        lastPage: to + 1,
        chars,
        bytes: bytes.byteLength,
        file: new Blob([bytes as BlobPart], { type: "application/pdf" }),
      });
    }
    if (fits) return chunks;
    n++;
  }
  throw new Error("This PDF can't be split into parts small enough for DeepL.");
}

export async function mergePdfs(files: Blob[]): Promise<Blob> {
  const merged = await PDFDocument.create();
  for (const f of files) {
    const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
    for (const page of await merged.copyPages(doc, doc.getPageIndices())) {
      merged.addPage(page);
    }
  }
  const bytes = await merged.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
