import QRCode from "qrcode";

/** Dark modules of a QR symbol. The client draws them. No script is embedded. */
export function qrModules(text: string): number[][] {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const rows: number[][] = [];
  for (let y = 0; y < size; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < size; x += 1) row.push(qr.modules.get(x, y) ? 1 : 0);
    rows.push(row);
  }
  return rows;
}
