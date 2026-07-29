import html2pdf from "html2pdf.js";

/**
 * Export a DOM element as A4 PDF (white page, print-friendly).
 * @param {HTMLElement} element
 * @param {string} filename — without .pdf
 */
export async function downloadElementAsPdf(element, filename) {
  if (!element) throw new Error("Nothing to export");

  const safeName = (filename || "mindspring-export")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);

  const opt = {
    margin: [12, 12, 12, 12],
    filename: `${safeName}.pdf`,
    image: { type: "jpeg", quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak: { mode: ["avoid-all", "css", "legacy"] },
  };

  await html2pdf().set(opt).from(element).save();
}
