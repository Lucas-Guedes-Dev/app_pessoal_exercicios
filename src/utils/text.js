// "Feijão, Carioca" -> "feijao, carioca": busca sem se preocupar com acento ou maiúscula
export function normalize(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
