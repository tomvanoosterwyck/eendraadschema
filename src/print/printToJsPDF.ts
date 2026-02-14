// Import jsPDF types if available (otherwise use 'any')
declare global {
    interface Window {
        jspdf: any;
    }
}

type PrintTable = {
    papersize: string;
    pages: { start: number; stop: number; info: string }[];
    starty: number;
    stopy: number;
};

type Properties = {
    dpi?: number;
    control: string;
    owner: string;
    installer: string;
    info: string;
};

type SitPlanPrint = {
    numpages: number;
    pages: { svg: string; sizex: number; sizey: number }[];
};

type BomPrintData = {
    title: string;
    sections: { heading: string; lines: string[] }[];
};

type StatusCallback = { innerHTML: string } | null;

export function printPDF(
    svg: string,                            // SVG van het eendraadschema
    print_table: PrintTable,                // Informatie over de paginering van het eendraadschema
    properties: Properties,                 // Extra informatie zoals eigenaar, installateur, etc.  Ook het aantal DPI
    pagerange: string,                      // Pagina's die moeten worden afgedrukt, in de vorm "1-3,5,7-9" of "1,2,3" of "1-3"
    //pages: number[] = [1],                // Pagina's die moeten worden afgedrukt, standaard is pagina 1
    filename = "eendraadschema_print.pdf",  // Filename van de PDF die gegenereerd wordt
    statuscallback: StatusCallback,         // Via deze functie wordt de voortgang doorgegeven aan een oproepend element (doorgaans GUI)
    sitplanprint: SitPlanPrint,             // Informatie over het situatieschema
    bom?: BomPrintData                      // Materialen (BOM) als extra pagina(s)
): void {
    const setStatus = (html: string) => {
        if (statuscallback) statuscallback.innerHTML = html;
    };

    const normalizeSvgForRasterization = (svgText: string): string => {
        try {
            // Some SVG fragments (especially from editors) contain prefixed element/attribute names
            // like `xlink:href`, `inkscape:label`, `sodipodi:*` without carrying the corresponding
            // `xmlns:*` declarations after being embedded/concatenated. When such SVG is loaded
            // through Image(), browsers can error with "prefix not bound to a namespace" and the
            // rasterization silently fails.
            //
            // We don't need those prefixes for rendering, so strip them.
            let sanitized = svgText;

            // Ensure the root <svg> has the main SVG namespace.
            sanitized = sanitized.replace(
                /<svg\b(?![^>]*\bxmlns=)/,
                '<svg xmlns="http://www.w3.org/2000/svg"'
            );

            // Strip namespace prefixes from tag names: <foo:bar ...> -> <bar ...>
            sanitized = sanitized.replace(/<(\/?)\s*([A-Za-z_][\w.-]*):([\w.-]+)/g, '<$1$3');

            // Strip namespace prefixes from attribute names (but keep xmlns:* declarations intact).
            // Example: xlink:href -> href, inkscape:label -> label
            sanitized = sanitized.replace(/\b(?!xmlns:)([A-Za-z_][\w.-]*):([\w.-]+)=/g, '$2=');

            const parser = new DOMParser();
            const doc = parser.parseFromString(sanitized, "image/svg+xml");
            const root = doc.querySelector("svg");
            if (!root) return sanitized;

            // Ensure namespaces exist (important when loading as standalone SVG image).
            if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
            if (!root.getAttribute("xmlns:xlink")) root.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

            // Nested <svg> elements from imported files may miss xmlns.
            for (const svgEl of Array.from(doc.querySelectorAll("svg"))) {
                if (!svgEl.getAttribute("xmlns")) svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
            }

            // Improve compatibility for embedded images: mirror href -> xlink:href.
            const XLINK_NS = "http://www.w3.org/1999/xlink";
            for (const imgEl of Array.from(doc.querySelectorAll("image"))) {
                const href = imgEl.getAttribute("href");
                if (href && !imgEl.getAttribute("xlink:href")) {
                    imgEl.setAttributeNS(XLINK_NS, "xlink:href", href);
                }
            }

            return new XMLSerializer().serializeToString(root);
        } catch {
            return svgText;
        }
    };

    let paperdetails: any;

    if (print_table.papersize === "A3") {
        paperdetails = { // All sizes in millimeters
            paperwidth: 420,
            paperheight: 297,
            paper_margin: 10,
            svg_padding: 5, //minimal size to keep below svg before the text boxes start
            drawnby_box_height: 5,
            owner_box_height: 30,
            owner_box_width: 80,
        };
    } else {
        paperdetails = { // All sizes in millimeters
            paperwidth: 297,
            paperheight: 210,
            paper_margin: 10,
            svg_padding: 5, //minimal size to keep below svg before the text boxes start
            drawnby_box_height: 5,
            owner_box_height: 30,
            owner_box_width: 80,
        };
    }

    let pages: (number | null)[];
    const totalPages = print_table.pages.length + sitplanprint.numpages;

    let bomPageCount = 0;

    // Initialize all as null
    pages = Array(totalPages).fill(null);

    // Parse custom ranges
    const ranges = pagerange.split(',').map(r => r.trim());
    for (const range of ranges) {
        if (range.includes('-')) {
            const [start, end] = range.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) {
                    if (i >= 1 && i <= totalPages) pages[i - 1] = i;
                }
            }
        } else {
            const pageNum = Number(range);
            if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
                pages[pageNum - 1] = pageNum;
            }
        }
    }

    function svgToPng(
        svg: string,
        sizex: number,
        sizey: number,
        callback: (png: string | null, scale: number) => void
    ) {

        const max_height_in_mm =
            paperdetails.paperheight -
            2 * paperdetails.paper_margin -
            paperdetails.owner_box_height -
            paperdetails.drawnby_box_height -
            paperdetails.svg_padding;

        const max_width_in_mm =
            paperdetails.paperwidth - 2 * paperdetails.paper_margin;

        const dpi = properties.dpi || 300;
        const max_height_in_pixels = (max_height_in_mm / 25.4) * dpi;
        const max_width_in_pixels = (max_width_in_mm / 25.4) * dpi;

        const scale = Math.min(
            max_height_in_pixels / sizey,
            max_width_in_pixels / sizex
        );

        // The input can be either:
        // - a fragment (inner SVG markup without the outer <svg>), or
        // - a full <svg ...> document (used by the situation plan printer).
        // Wrapping a full <svg> inside another <svg> can break rendering (viewBox/minx/miny).
        let scaledsvg: string;
        const trimmed = svg.replace(/^\s+/, "");
        if (trimmed.startsWith("<svg")) {
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(svg, "image/svg+xml");
                const svgEl = doc.querySelector("svg");
                if (svgEl) {
                    svgEl.setAttribute("xmlns", svgEl.getAttribute("xmlns") || "http://www.w3.org/2000/svg");
                    svgEl.setAttribute("width", String(sizex * scale));
                    svgEl.setAttribute("height", String(sizey * scale));
                    // Ensure a viewBox exists (should already be present for sitplan pages).
                    if (!svgEl.getAttribute("viewBox")) {
                        svgEl.setAttribute("viewBox", `0 0 ${sizex} ${sizey}`);
                    }
                    scaledsvg = new XMLSerializer().serializeToString(svgEl);
                } else {
                    scaledsvg =
                        `<svg width="${sizex * scale}" height="${sizey * scale}" viewBox="0 0 ${sizex} ${sizey}" xmlns="http://www.w3.org/2000/svg">` +
                        svg +
                        "</svg>";
                }
            } catch {
                scaledsvg =
                    `<svg width="${sizex * scale}" height="${sizey * scale}" viewBox="0 0 ${sizex} ${sizey}" xmlns="http://www.w3.org/2000/svg">` +
                    svg +
                    "</svg>";
            }
        } else {
            scaledsvg =
                `<svg width="${sizex * scale}" height="${sizey * scale}" viewBox="0 0 ${sizex} ${sizey}" xmlns="http://www.w3.org/2000/svg">` +
                svg +
                "</svg>";
        }

        scaledsvg = normalizeSvgForRasterization(scaledsvg);

        // Very large SVGs (common for situation plans with embedded images) can exceed data: URL limits.
        // Use a Blob URL in that case.
        let url: string;
        let blobUrlCreated = false;
        if (scaledsvg.length > 500_000) {
            const svgBlob = new Blob([scaledsvg], { type: "image/svg+xml;charset=utf-8" });
            url = URL.createObjectURL(svgBlob);
            blobUrlCreated = true;
        } else {
            url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(scaledsvg);
        }

        const img = new Image();
        img.crossOrigin = "anonymous";
        let done = false;

        const finish = (png: string | null) => {
            if (done) return;
            done = true;
            callback(png, scale);
        };

        // If the image load stalls (very large SVGs, browser quirks), don't hang forever.
        const timeoutMs = 30000;
        const timer = window.setTimeout(() => finish(null), timeoutMs);

        img.onload = function () {
            window.clearTimeout(timer);
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            (canvas as any).crossOrigin = "anonymous";
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                canvas.remove();
                finish(null);
                return;
            }

            ctx.drawImage(img, 0, 0);
            try {
                const png = canvas.toDataURL("image/png");
                finish(png);
            } catch (e) {
                if (img.complete) {
                    alert(
                        "Er is een element in het (situatie)schema dat verwijst naar een andere website en dit veroorzaakt een security-error (CORS) in deze browser. Hierdoor kan die pagina niet in de PDF worden opgenomen als afbeelding."
                    );
                } else {
                    alert(
                        "Het genereren van de PDF is vastgelopen bij het omzetten van SVG naar PNG."
                    );
                }
                finish(null);
            } finally {
                if (blobUrlCreated && url.startsWith("blob:")) URL.revokeObjectURL(url);
                canvas.remove();
            }
        };

        img.onerror = function () {
            window.clearTimeout(timer);
            if (blobUrlCreated && url.startsWith("blob:")) URL.revokeObjectURL(url);
            finish(null);
        };

        img.src = url;
    }

    function htmlToPDFlines(doc: any, html: string): string[] {
        function htmlToUnicode(html: string): string {
            const tempElement = document.createElement("div");
            tempElement.innerHTML = html;
            return tempElement.textContent || tempElement.innerText || "";
        }

        let printlines: string[] = [];
        html = html.replace(/<div>/g, "");
        let lines = html.split(/<br>|<\/div>/).map(htmlToUnicode);
        for (let line of lines) {
            let wrappedlines = doc.splitTextToSize(
                line,
                paperdetails.owner_box_width - 2 * 2 - 3
            );
            printlines = printlines.concat(wrappedlines);
        }
        return printlines;
    }

    function init() {
        const { jsPDF } = window.jspdf;
        let doc: any;
        if (print_table.papersize === "A3") {
            doc = new jsPDF("landscape", "mm", "a3", true);
        } else {
            doc = new jsPDF("landscape", "mm", "a4", true);
        }
        return doc;
    }

    function estimateBomPages(doc: any, bom: BomPrintData): number {
        const margin = paperdetails.paper_margin;
        const maxWidth = paperdetails.paperwidth - 2 * margin;
        const lineHeight = 4; // mm, for font size ~10
        const headerGap = 6;

        let y = margin;
        let pages = 1;

        // Title
        y += 8;

        for (const section of bom.sections ?? []) {
            // Section heading
            y += headerGap;
            for (const line of section.lines ?? []) {
                if (line === '') {
                    y += lineHeight;
                    continue;
                }
                const wrapped = doc.splitTextToSize(String(line), maxWidth) as string[];
                const needed = wrapped.length * lineHeight;
                if (y + needed > paperdetails.paperheight - margin) {
                    pages += 1;
                    y = margin;
                }
                y += needed;
            }

            // small gap between sections
            y += lineHeight;
            if (y > paperdetails.paperheight - margin) {
                pages += 1;
                y = margin;
            }
        }

        return Math.max(1, pages);
    }

    function appendBomPages(doc: any): void {
        if (!bom || !Array.isArray(bom.sections) || bom.sections.length === 0) return;

        setStatus("Materialen (BOM) wordt toegevoegd..");

        const margin = paperdetails.paper_margin;
        const maxWidth = paperdetails.paperwidth - 2 * margin;
        const lineHeight = 4; // mm

        const basePages = typeof doc.getNumberOfPages === 'function' ? Number(doc.getNumberOfPages()) : 0;
        const totalPages = basePages + bomPageCount;

        const newPage = () => {
            doc.addPage();
            const currentPage = typeof doc.getNumberOfPages === 'function' ? Number(doc.getNumberOfPages()) : 0;
            doc.setFont("helvetica", "bold");
            doc.setFontSize(14);
            doc.text(String(bom.title || "Materialen (BOM)"), margin, margin + 2);

            doc.setFontSize(9);
            try {
                doc.text(`pagina ${currentPage}/${totalPages}`, paperdetails.paperwidth - margin, margin + 2, { align: 'right' });
            } catch {
                // Older jsPDF versions may not support align options; ignore.
            }

            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            return margin + 10;
        };

        let y = newPage();

        for (const section of bom.sections) {
            // Section heading
            if (y + 8 > paperdetails.paperheight - margin) y = newPage();
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.text(String(section.heading), margin, y);
            y += 6;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);

            for (const rawLine of section.lines ?? []) {
                const line = String(rawLine ?? '');
                if (line === '') {
                    y += lineHeight;
                    if (y > paperdetails.paperheight - margin) y = newPage();
                    continue;
                }

                const wrapped = doc.splitTextToSize(line, maxWidth) as string[];
                for (const w of wrapped) {
                    if (y > paperdetails.paperheight - margin) y = newPage();
                    doc.text(w, margin, y);
                    y += lineHeight;
                }
            }

            y += lineHeight;
        }
    }

    function addPage(doc: any, svg: string, sizex: number, sizey: number, callback: (doc: any, iter: number) => void, iter = 0) {

        svgToPng(svg, sizex, sizey, function (png, scale) {
            let canvasx = paperdetails.paperwidth - 2 * paperdetails.paper_margin;
            let canvasy = paperdetails.paperheight - 2 * paperdetails.paper_margin - paperdetails.owner_box_height - paperdetails.drawnby_box_height - paperdetails.svg_padding;

            if (png && sizex * sizey > 0) {
                try {
                    // width is leading
                    if (sizex / sizey > canvasx / canvasy) {
                        let max_height_in_mm = paperdetails.paperheight - 2 * paperdetails.paper_margin - paperdetails.owner_box_height - paperdetails.drawnby_box_height - paperdetails.svg_padding;
                        let shiftdown = (max_height_in_mm - (sizey / sizex) * canvasx) / 2;
                        doc.addImage(png, "PNG", paperdetails.paper_margin, paperdetails.paper_margin + shiftdown, canvasx, (sizey / sizex) * canvasx, undefined, "FAST");
                    } else {
                        // height is leading
                        doc.addImage(png, "PNG", paperdetails.paper_margin, paperdetails.paper_margin, (sizex / sizey) * canvasy, canvasy, undefined, "FAST");
                    }
                } catch {
                    // If addImage fails for any reason, keep going (PDF will contain text boxes).
                }
            }

            doc.setProperties({
                title: "Eendraadschema.pdf",
                subject: "Eendraadschema",
                author: "eendraadschema.goethals-jacobs.be",
                keywords: "eendraadschema, online",
                creator: "eendraadschema.goethals-jacobs.be",
            });

            let startx = paperdetails.paperwidth - (297 - paperdetails.paper_margin); //In "A4" we fill everything, in A3 we squeeze to the right

            doc.rect(startx, // Drawn by box below
                     paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height,
                     3 * paperdetails.owner_box_width,
                     paperdetails.drawnby_box_height);
            doc.rect(startx, // first large box from left to right
                     paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height - paperdetails.owner_box_height,
                     paperdetails.owner_box_width,
                     paperdetails.owner_box_height);
            doc.rect(startx + paperdetails.owner_box_width, // second large box from left to right
                     paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height - paperdetails.owner_box_height,
                     paperdetails.owner_box_width,
                     paperdetails.owner_box_height);
            doc.rect(startx + 2 * paperdetails.owner_box_width, // third large box from left to right
                     paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height - paperdetails.owner_box_height,
                     paperdetails.owner_box_width,
                     paperdetails.owner_box_height);
            doc.rect(startx + 3 * paperdetails.owner_box_width, // Last box at the right
                     paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height - paperdetails.owner_box_height,
                     paperdetails.paperwidth - paperdetails.paper_margin - startx - 3 * paperdetails.owner_box_width,
                     paperdetails.drawnby_box_height + paperdetails.owner_box_height);

            const fontSize = 8;
            const textHeight = fontSize * 0.352778; // 1 point = 0.352778 mm

            doc.setFont("helvetica", "bold");
            doc.setFontSize(fontSize);

            doc.text("Getekend met https://eendraadschema.goethals-jacobs.be", 
                     startx + 2, // Leave 2mm at the left of the drawn by text
                     paperdetails.paperheight - paperdetails.paper_margin - (paperdetails.drawnby_box_height - textHeight) / 2 - textHeight / 6);

            let page = iter + 1;
            let maxpages = print_table.pages.length + sitplanprint.numpages + bomPageCount;

            doc.text("pagina. " + page + "/" + maxpages,
                     startx + 3 * paperdetails.owner_box_width + 2, //Leave 2mm at the left 
                     paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height - paperdetails.owner_box_height - textHeight / 6 + textHeight + 1.5);

            let pagename = iter < print_table.pages.length ? "Eendraadschema" : "Situatieschema";

            doc.text(pagename, 
                     startx + 3 * paperdetails.owner_box_width + 2, //Leave 2mm at the left 
                     paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height - paperdetails.owner_box_height - textHeight / 6 + textHeight * (1 + 1.2) + 1.5);
            
            doc.text(htmlToPDFlines(doc, "Erkend Organisme"), 
                     startx + 2,
                     paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height - paperdetails.owner_box_height - textHeight / 6 + textHeight + 1.5);

            doc.text(htmlToPDFlines(doc, "Plaats van de elektrische installatie"), 
                     startx + paperdetails.owner_box_width + 2, 
                     paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height - paperdetails.owner_box_height - textHeight / 6 + textHeight + 1.5);

            doc.text(htmlToPDFlines(doc, "Installateur"), 
                     startx + 2 * paperdetails.owner_box_width + 2, 
                     paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height - paperdetails.owner_box_height - textHeight / 6 + textHeight + 1.5);

            doc.setFont("helvetica", "normal");

            doc.text(htmlToPDFlines(doc, properties.control).slice(0, 8),
                                    startx + 2 + 3,
                                    paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height - paperdetails.owner_box_height - textHeight / 6 + textHeight * (1 + 1.2) + 1.5);

            doc.text(htmlToPDFlines(doc, properties.owner).slice(0, 8), 
                     startx + paperdetails.owner_box_width + 2 + 3, 
                     paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height - paperdetails.owner_box_height - textHeight / 6 + textHeight * (1 + 1.2) + 1.5);

            doc.text(htmlToPDFlines(doc, properties.installer).slice(0, 8), 
                     startx + 2 * paperdetails.owner_box_width + 2 + 3, 
                     paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height - paperdetails.owner_box_height - textHeight / 6 + textHeight * (1 + 1.2) + 1.5);

            let info : string = (iter < print_table.pages.length ? 
                                    print_table.pages[iter].info || properties.info || "" :
                                    properties.info || "");
                                             
            let infoshorter = info.replace("https://www.eendraadschema.goethals-jacobs.be", "eendraadschema");

            doc.text(htmlToPDFlines(doc, infoshorter).slice(0, 8), 
                     startx + 3 * paperdetails.owner_box_width + 2 + 3,
                     paperdetails.paperheight - paperdetails.paper_margin - paperdetails.drawnby_box_height - paperdetails.owner_box_height - textHeight / 6 + textHeight * (1 + 3 * 1.2) + 1.5);

            callback(doc, iter + 1);
        });
    }

    function cropSVG(svg: string, page: number): string {
        let startx = print_table.pages[page].start;
        let width = print_table.pages[page].stop - startx;
        let starty = print_table.starty;
        let height = print_table.stopy - starty;

        let viewbox = `${startx} ${starty} ${width} ${height}`;

        let outsvg =
            `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" transform="scale(1,1)" style="border:1px solid white" ` +
            `height="${height}" width="${width}" viewBox="${viewbox}">` +
            svg +
            "</svg>";

        return outsvg;
    }

    function nextpage(doc: any, iter = 0) {

        // Check if this is the first page we will print
        let firstpage = false;
        let idx = pages.findIndex((page) => page !== null);
        if (iter === idx) firstpage = true;
        
        if (iter < print_table.pages.length) {
            if (pages[iter] == null) {
                nextpage(doc, iter + 1);
            } else {
                setStatus("Pagina " + pages[iter] + " wordt gegenereerd. Even geduld..");

                if (!firstpage) doc.addPage();

                let sizex = print_table.pages[pages[iter] - 1].stop - print_table.pages[pages[iter] - 1].start;
                let sizey = print_table.stopy - print_table.starty;

                addPage(doc, cropSVG(svg, pages[iter] - 1), sizex, sizey, nextpage, iter);
            }
        } else if (iter < pages.length) {
            if (pages[iter] == null) {
                nextpage(doc, iter + 1);
            } else {
                setStatus("Pagina " + (iter + 1) + " wordt gegenereerd. Even geduld..");

                if (!firstpage) doc.addPage();

                let toprint = sitplanprint.pages[iter - print_table.pages.length];
                addPage(doc, toprint.svg, toprint.sizex, toprint.sizey, nextpage, iter);
            }
        } else {
            appendBomPages(doc);
            save(doc);
        }
    }

    function save(doc: any) {
        // Some browsers block automatic downloads if they happen after async work.
        // Using a Blob URL + <a download> is generally more reliable, and we also provide a manual link fallback.
        try {
            const blob: Blob = doc.output("blob");
            const blobUrl = URL.createObjectURL(blob);

            // Attempt automatic download.
            try {
                const a = document.createElement("a");
                a.href = blobUrl;
                a.download = filename;
                a.rel = "noopener";
                a.style.display = "none";
                document.body.appendChild(a);
                a.click();
                a.remove();
            } catch {
                // If programmatic click is blocked, user can still use the manual link below.
            }

            setStatus(
                'PDF is klaar. Indien de download niet start: <a href="' +
                    blobUrl +
                    '" download="' +
                    filename.replace(/"/g, "&quot;") +
                    '">klik hier om te downloaden</a>.'
            );

            // Revoke later to keep the manual link usable.
            setTimeout(() => URL.revokeObjectURL(blobUrl), 2 * 60 * 1000);
        } catch (e) {
            // Fall back to jsPDF's built-in save.
            doc.save(filename);
            setStatus("PDF is klaar. Kijk in uw Downloads folder indien deze niet spontaan wordt geopend.");
        }
    }

    setStatus("PDF wordt gegenereerd. Even geduld..");
    let doc = init();
    bomPageCount = bom ? estimateBomPages(doc, bom) : 0;
    nextpage(doc, 0);
}