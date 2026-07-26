import writeXlsxFile, { type Cell } from "write-excel-file/browser";

const MAX_ROWS = 10_000;
const MAX_COLUMNS = 100;

function safeFileName(value: unknown): string {
  const normalized = String(value || "planilha")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\.+$/g, "")
    .trim()
    .slice(0, 120);

  return normalized || "planilha";
}

function toCellValue(value: unknown): string | number | boolean {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function exportRecordsToXlsx(fileName: unknown, input: unknown): Promise<void> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("A planilha precisa conter ao menos uma linha.");
  }

  if (input.length > MAX_ROWS) {
    throw new Error(`A planilha excede o limite seguro de ${MAX_ROWS.toLocaleString("pt-BR")} linhas.`);
  }

  const records = input.map((item) => (
    item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : { valor: item }
  ));

  const columns = Array.from(
    new Set(records.flatMap((record) => Object.keys(record)))
  ).slice(0, MAX_COLUMNS);

  if (columns.length === 0) {
    columns.push("valor");
  }

  const rows: Cell[][] = [
    columns.map((column) => ({
      value: column,
      fontWeight: "bold",
      backgroundColor: "#DCE8FF",
      color: "#0A1A3A"
    })),
    ...records.map((record) => columns.map((column) => ({
      value: toCellValue(record[column]),
      wrap: true
    })))
  ];

  await writeXlsxFile(rows).toFile(`${safeFileName(fileName)}.xlsx`);
}
