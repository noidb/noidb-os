/** 브라우저에서 고른 파일을 서버 API로 보낼 base64 문자열로 바꾼다(공용 유틸 — 발주확정 원본
 *  업로드, 한진 송장번호 파일 업로드 등 여러 화면에서 재사용). data:...;base64,... 형태로
 *  돌려주며, 서버 쪽 디코더는 이 접두어가 있어도/없어도 처리한다. */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
