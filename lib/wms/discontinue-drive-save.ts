import { generatedDriveSaveHeaders } from "./google-drive-oauth-writer";

/** 2026-11-06: 단종 신청 서류는 G:\내 드라이브\쿠팡데이터\제품관리\단종신청, 단종 해제 서류는 ...\제품관리\단종해제 에 저장한다. */
export const DISCONTINUE_DRIVE_FOLDER = ["쿠팡데이터", "제품관리", "단종신청"];
export const RELEASE_DRIVE_FOLDER = ["쿠팡데이터", "제품관리", "단종해제"];

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type DriveSaveResult = { driveSaved: boolean; driveFolder: string; driveFileNames: string[]; driveWarning: string };

/** 단종신청 엑셀과 공문 PDF를 각각 단종신청 폴더에 저장한다(압축을 풀지 않고 바로 쓰도록). 저장 실패는 던지지 않고 결과로 알린다. */
export async function saveDiscontinueDocs(xlsx: Buffer | Uint8Array, pdf: Buffer | Uint8Array, compact: string, count: number): Promise<DriveSaveResult> {
  const files = [
    { name: `단종신청_${compact}_${count}건.xlsx`, data: xlsx, mime: XLSX_MIME },
    { name: `로켓배송_단종요청_공문_${compact}_${count}건.pdf`, data: pdf, mime: "application/pdf" },
  ];
  const results = await Promise.all(files.map(file => generatedDriveSaveHeaders(file.data, file.name, file.mime, DISCONTINUE_DRIVE_FOLDER)));
  const driveSaved = results.every(headers => headers["X-NOIDB-Drive-Saved"] === "true");
  return {
    driveSaved,
    driveFolder: DISCONTINUE_DRIVE_FOLDER.join("\\"),
    driveFileNames: results.map((headers, index) => headers["X-NOIDB-Drive-Saved"] === "true" ? decodeURIComponent(headers["X-NOIDB-Drive-File-Name"] || files[index].name) : "").filter(Boolean),
    driveWarning: driveSaved ? "" : [...new Set(results.map(headers => decodeURIComponent(headers["X-NOIDB-Drive-Save-Warning"] || "")).filter(Boolean))].join(" ") || "Drive 자동저장에 실패했습니다.",
  };
}

/** 단종해제 쿠팡 양식 엑셀을 단종해제 폴더에 저장한다. */
export async function saveReleaseFile(xlsx: Buffer | Uint8Array, fileName: string): Promise<DriveSaveResult> {
  const headers = await generatedDriveSaveHeaders(xlsx, fileName, XLSX_MIME, RELEASE_DRIVE_FOLDER);
  const driveSaved = headers["X-NOIDB-Drive-Saved"] === "true";
  return {
    driveSaved,
    driveFolder: RELEASE_DRIVE_FOLDER.join("\\"),
    driveFileNames: driveSaved ? [decodeURIComponent(headers["X-NOIDB-Drive-File-Name"] || fileName)] : [],
    driveWarning: driveSaved ? "" : decodeURIComponent(headers["X-NOIDB-Drive-Save-Warning"] || "") || "Drive 자동저장에 실패했습니다.",
  };
}
