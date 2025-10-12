// Tell TypeScript about the PDFKit standalone build (no official types for this path)
declare module 'pdfkit/js/pdfkit.standalone.js' {
  // We don't need full typings here — keeping it simple
  const PDFDocument: any;
  export default PDFDocument;
}