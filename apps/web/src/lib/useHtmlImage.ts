import { useEffect, useState } from "react";

export function useHtmlImage(url: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!url) {
      setImage(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    const handleLoad = (): void => setImage(img);
    img.addEventListener("load", handleLoad);
    return () => {
      img.removeEventListener("load", handleLoad);
    };
  }, [url]);

  return image;
}
