import JSZip from "jszip";

// Joins several .docx files end to end, the way docxcompose does: the first
// file is the base, and each following file's body is appended after a
// section break, along with the images, headers/footers, list definitions,
// styles and footnotes it relies on.

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
  ct: "http://schemas.openxmlformats.org/package/2006/content-types",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
  xmlns: "http://www.w3.org/2000/xmlns/",
};

const RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const REL = {
  officeDocument: RT + "officeDocument",
  numbering: RT + "numbering",
  footnotes: RT + "footnotes",
  endnotes: RT + "endnotes",
};
const CT = {
  numbering: "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
  footnotes: "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
  endnotes: "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml",
};

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ---------- small path and XML helpers ----------

function dirOf(path: string) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function relsPathOf(partPath: string) {
  const dir = dirOf(partPath);
  const name = partPath.slice(dir.length ? dir.length + 1 : 0);
  return `${dir ? dir + "/" : ""}_rels/${name}.rels`;
}

function normalise(path: string) {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

function resolveTarget(partPath: string, target: string) {
  if (target.startsWith("/")) return normalise(target);
  return normalise(`${dirOf(partPath)}/${target}`);
}

function relativeTarget(fromPart: string, toPath: string) {
  const from = dirOf(fromPart).split("/").filter(Boolean);
  const to = toPath.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill(".."), ...to.slice(i)].join("/");
}

function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("Couldn't read part of a Word file");
  }
  return doc;
}

function serialise(doc: Document) {
  const xml = new XMLSerializer().serializeToString(doc);
  return xml.startsWith("<?xml") ? xml : XML_DECL + xml;
}

function children(el: Element, ns: string, localName: string): Element[] {
  return Array.from(el.children).filter(
    (c) => c.namespaceURI === ns && c.localName === localName
  );
}

function descendants(root: Element | Document, ns: string, localName: string) {
  return Array.from(root.getElementsByTagNameNS(ns, localName));
}

function wAttr(el: Element, name: string) {
  return el.getAttributeNS(NS.w, name);
}

function setWAttr(el: Element, name: string, value: string) {
  el.setAttributeNS(NS.w, `w:${name}`, value);
}

// Make sure every namespace prefix used in `src` is declared on the root of
// `dest`, and that Word's list of ignorable prefixes covers them too.
function mergeNamespaces(dest: Document, src: Document) {
  const d = dest.documentElement;
  const s = src.documentElement;
  for (const attr of Array.from(s.attributes)) {
    if (attr.namespaceURI === NS.xmlns && !d.hasAttribute(attr.name)) {
      d.setAttributeNS(NS.xmlns, attr.name, attr.value);
    }
  }
  const srcIgnorable = s.getAttributeNS(NS.mc, "Ignorable");
  if (srcIgnorable) {
    const current = (d.getAttributeNS(NS.mc, "Ignorable") || "").split(/\s+/).filter(Boolean);
    for (const p of srcIgnorable.split(/\s+/)) {
      if (p && !current.includes(p) && d.hasAttribute(`xmlns:${p}`)) current.push(p);
    }
    d.setAttributeNS(NS.mc, "mc:Ignorable", current.join(" "));
  }
}

// ---------- package wrapper ----------

type Rel = { id: string; type: string; target: string; external: boolean };

class Package {
  private xmlCache = new Map<string, Document>();
  constructor(public zip: JSZip) {}

  static async load(file: Blob) {
    return new Package(await JSZip.loadAsync(await file.arrayBuffer()));
  }

  has(path: string) {
    return this.zip.file(path) !== null;
  }

  async xml(path: string): Promise<Document> {
    let doc = this.xmlCache.get(path);
    if (!doc) {
      const text = await this.zip.file(path)?.async("string");
      if (text === undefined) throw new Error(`Missing ${path} in Word file`);
      doc = parse(text);
      this.xmlCache.set(path, doc);
    }
    return doc;
  }

  setXml(path: string, doc: Document) {
    this.xmlCache.set(path, doc);
  }

  async rels(partPath: string): Promise<Rel[]> {
    const path = relsPathOf(partPath);
    if (!this.has(path)) return [];
    const doc = await this.xml(path);
    return descendants(doc, NS.rel, "Relationship").map((r) => ({
      id: r.getAttribute("Id")!,
      type: r.getAttribute("Type")!,
      target: r.getAttribute("Target")!,
      external: r.getAttribute("TargetMode") === "External",
    }));
  }

  async relsDoc(partPath: string): Promise<Document> {
    const path = relsPathOf(partPath);
    if (!this.has(path) && !this.xmlCache.has(path)) {
      this.setXml(path, parse(`${XML_DECL}<Relationships xmlns="${NS.rel}"/>`));
    }
    return this.xml(path);
  }

  async addRel(partPath: string, type: string, target: string, external = false) {
    const doc = await this.relsDoc(partPath);
    const used = new Set(
      descendants(doc, NS.rel, "Relationship").map((r) => r.getAttribute("Id"))
    );
    let n = used.size + 1;
    while (used.has(`rIdM${n}`)) n++;
    const id = `rIdM${n}`;
    const el = doc.createElementNS(NS.rel, "Relationship");
    el.setAttribute("Id", id);
    el.setAttribute("Type", type);
    el.setAttribute("Target", target);
    if (external) el.setAttribute("TargetMode", "External");
    doc.documentElement.appendChild(el);
    return id;
  }

  async mainDocumentPath(): Promise<string> {
    const rel = (await this.rels("")).find((r) => r.type === REL.officeDocument);
    return rel ? resolveTarget("", rel.target) : "word/document.xml";
  }

  async contentTypes() {
    return this.xml("[Content_Types].xml");
  }

  async overrideFor(path: string): Promise<string | null> {
    const ct = await this.contentTypes();
    const o = descendants(ct, NS.ct, "Override").find(
      (e) => normalise(e.getAttribute("PartName") || "") === path
    );
    return o?.getAttribute("ContentType") ?? null;
  }

  async addOverride(path: string, contentType: string) {
    const ct = await this.contentTypes();
    if (await this.overrideFor(path)) return;
    const el = ct.createElementNS(NS.ct, "Override");
    el.setAttribute("PartName", "/" + path);
    el.setAttribute("ContentType", contentType);
    ct.documentElement.appendChild(el);
  }

  async ensureDefault(extension: string, contentType: string) {
    const ct = await this.contentTypes();
    const exists = descendants(ct, NS.ct, "Default").some(
      (e) => e.getAttribute("Extension")?.toLowerCase() === extension.toLowerCase()
    );
    if (exists) return;
    const el = ct.createElementNS(NS.ct, "Default");
    el.setAttribute("Extension", extension);
    el.setAttribute("ContentType", contentType);
    ct.documentElement.insertBefore(el, ct.documentElement.firstChild);
  }

  async defaultFor(extension: string): Promise<string | null> {
    const ct = await this.contentTypes();
    const d = descendants(ct, NS.ct, "Default").find(
      (e) => e.getAttribute("Extension")?.toLowerCase() === extension.toLowerCase()
    );
    return d?.getAttribute("ContentType") ?? null;
  }

  async toBlob(): Promise<Blob> {
    for (const [path, doc] of this.xmlCache) this.zip.file(path, serialise(doc));
    return this.zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }
}

// ---------- merging ----------

class Merger {
  private chunkNo = 1;
  private copied = new Map<string, string>();

  constructor(
    private master: Package,
    private masterDocPath: string,
    private masterDoc: Document
  ) {}

  private get masterBody() {
    return children(this.masterDoc.documentElement, NS.w, "body")[0];
  }

  // Moves a body's closing section properties into a paragraph, turning
  // them into a section break so the next file starts its own section.
  private sectionBreakFrom(doc: Document, body: Element): Element | null {
    const sectPr = children(body, NS.w, "sectPr")[0];
    if (!sectPr) return null;
    const p = doc.createElementNS(NS.w, "w:p");
    const pPr = doc.createElementNS(NS.w, "w:pPr");
    p.appendChild(pPr);
    pPr.appendChild(sectPr);
    return p;
  }

  async init() {
    const body = this.masterBody;
    const brk = this.sectionBreakFrom(this.masterDoc, body);
    if (brk) body.appendChild(brk);
  }

  // Copies a part (an image, header, chart…) and anything it links to.
  private async copyPart(src: Package, srcPath: string): Promise<string> {
    const already = this.copied.get(srcPath);
    if (already) return already;

    const name = srcPath.slice(dirOf(srcPath).length + 1);
    let destPath = `${dirOf(srcPath)}/m${this.chunkNo}_${name}`;
    for (let n = 2; this.master.has(destPath); n++) {
      destPath = `${dirOf(srcPath)}/m${this.chunkNo}_${n}_${name}`;
    }
    this.copied.set(srcPath, destPath);

    const data = await src.zip.file(srcPath)?.async("uint8array");
    if (!data) return destPath;
    this.master.zip.file(destPath, data);

    const override = await src.overrideFor(srcPath);
    if (override) {
      await this.master.addOverride(destPath, override);
    } else {
      const ext = name.split(".").pop() || "";
      const def = await src.defaultFor(ext);
      if (def) await this.master.ensureDefault(ext, def);
    }

    const rels = await src.rels(srcPath);
    if (rels.length) {
      const relsDoc = parse(await src.zip.file(relsPathOf(srcPath))!.async("string"));
      for (const r of descendants(relsDoc, NS.rel, "Relationship")) {
        if (r.getAttribute("TargetMode") === "External") continue;
        const child = resolveTarget(srcPath, r.getAttribute("Target")!);
        r.setAttribute("Target", relativeTarget(destPath, await this.copyPart(src, child)));
      }
      this.master.setXml(relsPathOf(destPath), relsDoc);
    }
    return destPath;
  }

  // Recreates the relationships that `content` refers to (images,
  // hyperlinks, headers…) on destPart; returns old id → new id. Parts such
  // as styles and numbering are never referenced from content, so they're
  // left alone here and merged separately.
  private async importRels(
    src: Package,
    srcPart: string,
    destPart: string,
    content: Element[]
  ) {
    const referenced = new Set<string>();
    for (const root of content) {
      for (const el of [root, ...Array.from(root.getElementsByTagName("*"))]) {
        for (const attr of Array.from(el.attributes)) {
          if (attr.namespaceURI === NS.r) referenced.add(attr.value);
        }
      }
    }
    const map = new Map<string, string>();
    for (const rel of await src.rels(srcPart)) {
      if (!referenced.has(rel.id)) continue;
      if (rel.external) {
        map.set(rel.id, await this.master.addRel(destPart, rel.type, rel.target, true));
        continue;
      }
      const copied = await this.copyPart(src, resolveTarget(srcPart, rel.target));
      map.set(
        rel.id,
        await this.master.addRel(destPart, rel.type, relativeTarget(destPart, copied))
      );
    }
    return map;
  }

  private remapRelIds(root: Element, map: Map<string, string>) {
    const all = [root, ...Array.from(root.getElementsByTagName("*"))];
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        if (attr.namespaceURI === NS.r && map.has(attr.value)) {
          attr.value = map.get(attr.value)!;
        }
      }
    }
  }

  private remapWVal(root: Element, localName: string, attr: string, map: Map<string, string>) {
    const els = root.localName === localName ? [root] : [];
    els.push(...descendants(root, NS.w, localName));
    for (const el of els) {
      const v = wAttr(el, attr);
      if (v !== null && map.has(v)) setWAttr(el, attr, map.get(v)!);
    }
  }

  private async partPath(pkg: Package, docPath: string, type: string) {
    const rel = (await pkg.rels(docPath)).find((r) => r.type === type);
    return rel ? resolveTarget(docPath, rel.target) : null;
  }

  // Appends the list definitions; returns old numId → new numId.
  private async mergeNumbering(src: Package, srcDocPath: string) {
    const map = new Map<string, string>();
    const srcPath = await this.partPath(src, srcDocPath, REL.numbering);
    if (!srcPath || !src.has(srcPath)) return map;
    const srcNum = await src.xml(srcPath);

    let destPath = await this.partPath(this.master, this.masterDocPath, REL.numbering);
    if (!destPath) {
      destPath = normalise(`${dirOf(this.masterDocPath)}/numbering.xml`);
      this.master.setXml(destPath, parse(`${XML_DECL}<w:numbering xmlns:w="${NS.w}"/>`));
      await this.master.addRel(this.masterDocPath, REL.numbering, "numbering.xml");
      await this.master.addOverride(destPath, CT.numbering);
    }
    const dest = await this.master.xml(destPath);
    mergeNamespaces(dest, srcNum);
    const root = dest.documentElement;

    const maxOf = (name: string, attr: string) =>
      Math.max(
        0,
        ...children(root, NS.w, name).map((e) => Number(wAttr(e, attr)) || 0)
      );
    let nextAbstract = maxOf("abstractNum", "abstractNumId") + 1;
    let nextNum = maxOf("num", "numId") + 1;
    const firstNum = children(root, NS.w, "num")[0] ?? null;
    const abstractMap = new Map<string, string>();

    for (const a of children(srcNum.documentElement, NS.w, "abstractNum")) {
      const copy = dest.importNode(a, true) as Element;
      const id = String(nextAbstract++);
      abstractMap.set(wAttr(a, "abstractNumId")!, id);
      setWAttr(copy, "abstractNumId", id);
      // Word links lists sharing an nsid, so give each copy its own.
      for (const nsid of children(copy, NS.w, "nsid")) {
        setWAttr(nsid, "val", Math.floor(Math.random() * 0xffffffff).toString(16).toUpperCase().padStart(8, "0"));
      }
      root.insertBefore(copy, firstNum);
    }
    for (const n of children(srcNum.documentElement, NS.w, "num")) {
      const copy = dest.importNode(n, true) as Element;
      const id = String(nextNum++);
      map.set(wAttr(n, "numId")!, id);
      setWAttr(copy, "numId", id);
      for (const ref of children(copy, NS.w, "abstractNumId")) {
        const v = abstractMap.get(wAttr(ref, "val")!);
        if (v) setWAttr(ref, "val", v);
      }
      root.appendChild(copy);
    }
    return map;
  }

  // Adds styles the base document doesn't have. Where both define a style
  // with the same id, the base document's version wins.
  private async mergeStyles(src: Package, srcDocPath: string, numMap: Map<string, string>) {
    const srcPath = (await src.rels(srcDocPath)).find((r) => r.type === RT + "styles");
    const destRel = (await this.master.rels(this.masterDocPath)).find(
      (r) => r.type === RT + "styles"
    );
    if (!srcPath || !destRel) return;
    const srcStyles = await src.xml(resolveTarget(srcDocPath, srcPath.target));
    const dest = await this.master.xml(resolveTarget(this.masterDocPath, destRel.target));
    mergeNamespaces(dest, srcStyles);
    const existing = new Set(
      children(dest.documentElement, NS.w, "style").map((s) => wAttr(s, "styleId"))
    );
    for (const s of children(srcStyles.documentElement, NS.w, "style")) {
      if (existing.has(wAttr(s, "styleId"))) continue;
      const copy = dest.importNode(s, true) as Element;
      this.remapWVal(copy, "numId", "val", numMap);
      dest.documentElement.appendChild(copy);
    }
  }

  // Appends footnotes or endnotes; returns old id → new id.
  private async mergeNotes(
    src: Package,
    srcDocPath: string,
    kind: "footnote" | "endnote"
  ) {
    const map = new Map<string, string>();
    const type = kind === "footnote" ? REL.footnotes : REL.endnotes;
    const srcPath = await this.partPath(src, srcDocPath, type);
    if (!srcPath || !src.has(srcPath)) return map;
    const srcNotes = await src.xml(srcPath);
    const notes = children(srcNotes.documentElement, NS.w, kind).filter(
      (n) => !wAttr(n, "type") || wAttr(n, "type") === "normal"
    );
    if (!notes.length) return map;

    let destPath = await this.partPath(this.master, this.masterDocPath, type);
    if (!destPath) {
      // The base has no notes part: take this one's wholesale (separators included).
      destPath = normalise(`${dirOf(this.masterDocPath)}/${kind}s.xml`);
      this.master.setXml(
        destPath,
        parse(`${XML_DECL}<w:${kind}s xmlns:w="${NS.w}"/>`)
      );
      await this.master.addRel(this.masterDocPath, type, `${kind}s.xml`);
      await this.master.addOverride(
        destPath,
        kind === "footnote" ? CT.footnotes : CT.endnotes
      );
      const dest = await this.master.xml(destPath);
      for (const n of children(srcNotes.documentElement, NS.w, kind)) {
        if (wAttr(n, "type") && wAttr(n, "type") !== "normal") {
          dest.documentElement.appendChild(dest.importNode(n, true));
        }
      }
    }
    const dest = await this.master.xml(destPath);
    mergeNamespaces(dest, srcNotes);
    const relMap = await this.importRels(src, srcPath, destPath, notes);
    let next =
      Math.max(0, ...children(dest.documentElement, NS.w, kind).map((n) => Number(wAttr(n, "id")) || 0)) + 1;
    for (const n of notes) {
      const copy = dest.importNode(n, true) as Element;
      const id = String(next++);
      map.set(wAttr(n, "id")!, id);
      setWAttr(copy, "id", id);
      this.remapRelIds(copy, relMap);
      dest.documentElement.appendChild(copy);
    }
    return map;
  }

  async append(file: Blob, isLast: boolean) {
    this.chunkNo++;
    this.copied.clear();
    const src = await Package.load(file);
    const srcDocPath = await src.mainDocumentPath();
    const srcDoc = await src.xml(srcDocPath);
    const srcBody = children(srcDoc.documentElement, NS.w, "body")[0];
    if (!srcBody) return;

    mergeNamespaces(this.masterDoc, srcDoc);
    const relMap = await this.importRels(src, srcDocPath, this.masterDocPath, [srcBody]);
    const numMap = await this.mergeNumbering(src, srcDocPath);
    await this.mergeStyles(src, srcDocPath, numMap);
    const footMap = await this.mergeNotes(src, srcDocPath, "footnote");
    const endMap = await this.mergeNotes(src, srcDocPath, "endnote");

    // Keep bookmark ids unique across the merged document.
    const bookmarkBase =
      Math.max(
        0,
        ...descendants(this.masterBody, NS.w, "bookmarkStart").map((b) => Number(wAttr(b, "id")) || 0)
      ) + 1;

    const sectPr = children(srcBody, NS.w, "sectPr")[0];
    const body = this.masterBody;
    const finalSectPr = children(body, NS.w, "sectPr")[0] ?? null;

    for (const node of Array.from(srcBody.childNodes)) {
      if (node === sectPr) continue;
      const copy = this.masterDoc.importNode(node, true);
      if (copy.nodeType === Node.ELEMENT_NODE) {
        const el = copy as Element;
        this.remapRelIds(el, relMap);
        this.remapWVal(el, "numId", "val", numMap);
        this.remapWVal(el, "footnoteReference", "id", footMap);
        this.remapWVal(el, "endnoteReference", "id", endMap);
        for (const name of ["bookmarkStart", "bookmarkEnd"]) {
          for (const b of descendants(el, NS.w, name)) {
            setWAttr(b, "id", String(bookmarkBase + (Number(wAttr(b, "id")) || 0)));
          }
        }
      }
      body.insertBefore(copy, finalSectPr);
    }

    if (sectPr) {
      const copy = this.masterDoc.importNode(sectPr, true) as Element;
      this.remapRelIds(copy, relMap);
      if (isLast) {
        body.appendChild(copy);
      } else {
        const p = this.masterDoc.createElementNS(NS.w, "w:p");
        const pPr = this.masterDoc.createElementNS(NS.w, "w:pPr");
        p.appendChild(pPr);
        pPr.appendChild(copy);
        body.appendChild(p);
      }
    }
  }

  finish() {
    // Drawing ids must be unique or Word offers to "repair" the file.
    descendants(this.masterDoc, NS.wp, "docPr").forEach((el, i) =>
      el.setAttribute("id", String(i + 1))
    );
  }
}

export async function mergeDocx(files: Blob[]): Promise<Blob> {
  if (files.length === 0) throw new Error("Nothing to merge");
  if (files.length === 1) return files[0];

  const master = await Package.load(files[0]);
  const docPath = await master.mainDocumentPath();
  const merger = new Merger(master, docPath, await master.xml(docPath));
  await merger.init();
  for (let i = 1; i < files.length; i++) {
    await merger.append(files[i], i === files.length - 1);
  }
  merger.finish();
  return master.toBlob();
}
