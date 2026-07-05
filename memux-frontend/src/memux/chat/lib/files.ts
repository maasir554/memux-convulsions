export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

export function filterImages(files: File[]): File[] {
  return files.filter((f) => f.type.startsWith("image/"));
}
